/**
 * Users tab ▸ "Permissions from" — pick SEVERAL custom roles for one person
 * (25 Nov 2026, reported: Employee + Interviewer could not be given together;
 * the old single <select> replaced every custom role with the one picked).
 *
 * A small popover anchored to the cell: tick the custom roles, Save posts the
 * same `POST /api/users/{id}/roles {roles, custom_roles}` the Edit Roles dialog
 * uses (built-in roles are sent unchanged — they stay in Edit Roles). The
 * person's permissions are every ticked role's, added up (server).
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Loader2, ShieldCheck } from "lucide-react";

export type PickerRole = { id: number; name: string; is_active: boolean };

/** What the cell's button says. PURE. */
export function rolesPickerLabel(customNames: string[], builtin: string[]): string {
  if (customNames.length) return customNames.join(" + ");
  const b = builtin.map((x) => x.replace(/_/g, " "));
  if (!b.length) return "Pick roles…";
  return `Built-in role${b.length === 1 ? "" : "s"} (${b.join(", ")})`;
}

/** Same set of ids, order ignored. PURE. */
export function samePicked(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** Why Save is off, or "" when it may save. PURE. */
export function pickerProblem(picked: number[], current: number[], builtin: string[]): string {
  if (samePicked(picked, current)) return "Nothing changed";
  if (!picked.length && !builtin.length) return "Keep at least one role — with none they cannot open the CRM";
  return "";
}

export function RolesPickerCell({
  userName,
  builtin,
  customNames,
  roles,
  disabled,
  onSave,
  onEditBuiltin,
}: {
  userName: string;
  builtin: string[];
  /** Custom-role NAMES the person holds now. */
  customNames: string[];
  /** Every custom role (active ones offered; inactive shown only when held). */
  roles: PickerRole[];
  disabled?: boolean;
  onSave: (ids: number[]) => Promise<void>;
  onEditBuiltin?: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean }>({ top: 0, left: 0, up: false });
  const current = roles.filter((r) => customNames.includes(r.name)).map((r) => r.id);
  const [picked, setPicked] = useState<number[]>(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  const offered = roles.filter((r) => r.is_active || customNames.includes(r.name));
  const shown = q.trim() ? offered.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase())) : offered;
  const problem = pickerProblem(picked, current, builtin);

  const place = () => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const width = 300;
    const up = window.innerHeight - b.bottom < 340 && b.top > 340;
    const left = Math.max(8, Math.min(b.left, window.innerWidth - width - 8));
    setPos({ top: up ? b.top - 6 : b.bottom + 6, left, up });
  };

  const openIt = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    setPicked(current);
    setError("");
    setQ("");
    place();
    setOpen(true);
  };

  useLayoutEffect(() => { if (open) place(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      if (!saving) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) { setOpen(false); btnRef.current?.focus(); } };
    const onMove = () => place();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, saving]);

  const toggle = (id: number) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const save = async () => {
    if (problem) return;
    setSaving(true);
    setError("");
    try {
      await onSave(picked);
      setOpen(false);
    } catch (e: any) {
      setError(e?.message || "Could not save the roles");
    } finally {
      setSaving(false);
    }
  };

  const label = rolesPickerLabel(customNames, builtin);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openIt}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Roles for ${userName}: ${label}. Change`}
        title="Pick one or more roles — their permissions add up"
        className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-control border border-subtle bg-surface-1 px-2.5 py-1.5 text-left text-xs font-semibold text-primary hover:border-strong disabled:opacity-60"
      >
        {disabled ? <Loader2 size={13} className="shrink-0 animate-spin" aria-hidden /> : <ShieldCheck size={13} className="shrink-0 text-emerald-600" aria-hidden />}
        <span className="min-w-0 truncate">{label}</span>
        {customNames.length > 1 && (
          <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            {customNames.length}
          </span>
        )}
        <ChevronDown size={13} className="shrink-0 opacity-60" aria-hidden />
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          role="dialog"
          aria-label={`Roles for ${userName}`}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: 300, transform: pos.up ? "translateY(-100%)" : undefined }}
          className="z-[70] rounded-card border border-subtle bg-surface-1 shadow-overlay"
        >
          <div className="border-b border-subtle px-3 py-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted">Roles for</div>
            <div className="truncate text-sm font-bold text-primary">{userName}</div>
            <p className="mt-1 text-[11px] leading-snug text-muted">Tick one or more. Their permissions add up.</p>
          </div>
          {offered.length > 6 && (
            <div className="border-b border-subtle px-3 py-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find a role…"
                aria-label="Find a role"
                className="w-full rounded-control border border-subtle bg-surface-1 px-2 py-1 text-xs text-primary"
              />
            </div>
          )}
          <div className="max-h-60 overflow-y-auto px-2 py-2">
            {shown.length === 0 && (
              <p className="px-1 py-2 text-xs text-muted">
                {offered.length ? "No role matches." : "No custom roles yet — create one on Roles & permissions."}
              </p>
            )}
            {shown.map((r) => {
              const on = picked.includes(r.id);
              return (
                <label
                  key={r.id}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-control px-2 py-1.5 text-sm ${
                    on ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200" : "text-primary hover:bg-surface-2"}`}
                >
                  <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={on} onChange={() => toggle(r.id)} />
                  <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                  {!r.is_active && <span className="rounded-full bg-surface-2 px-1.5 text-[10px] font-semibold text-muted">Inactive</span>}
                  {on && <Check size={14} className="shrink-0 text-emerald-600" aria-hidden />}
                </label>
              );
            })}
          </div>
          <div className="border-t border-subtle px-3 py-2 text-[11px] text-muted">
            Built-in: <b className="text-secondary">{builtin.length ? builtin.map((x) => x.replace(/_/g, " ")).join(", ") : "none"}</b>
            {onEditBuiltin && (
              <button
                type="button"
                className="ml-1 font-semibold text-brand-600 hover:underline dark:text-brand-300"
                onClick={() => { setOpen(false); onEditBuiltin(); }}
              >
                change in Edit Roles
              </button>
            )}
          </div>
          {error && <p className="mx-3 mb-2 rounded-control bg-danger-soft px-2 py-1.5 text-xs text-danger" role="alert">{error}</p>}
          <div className="flex items-center justify-between gap-2 border-t border-subtle px-3 py-2.5">
            <span className="min-w-0 truncate text-[11px] text-muted">
              {problem && problem !== "Nothing changed" ? problem : `${picked.length} picked`}
            </span>
            <span className="flex shrink-0 gap-1.5">
              <button type="button" className="rounded-control px-2.5 py-1 text-xs font-semibold text-secondary hover:bg-surface-2"
                onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-control bg-emerald-600 px-3 py-1 text-xs font-bold text-[#fff] hover:bg-emerald-700 disabled:opacity-50"
                onClick={save}
                disabled={saving || !!problem}
              >
                {saving && <Loader2 size={12} className="animate-spin" aria-hidden />}
                Save
              </button>
            </span>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
