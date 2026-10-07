/**
 * ForcePasswordChange (7 Oct 2026) — the only screen a user sees after an Admin /
 * CEO reset their password, until they set one only they know.
 *
 * The server enforces it (`crm_deps.get_current_user` answers every CRM call with
 * 403 PASSWORD_CHANGE_REQUIRED except `/api/me` and `/api/me/change-password`);
 * `/api/me.must_change_password` tells the shell to render this instead of the app.
 * The current password is the temporary one the admin handed over.
 */
import { useMemo, useState } from "react";
import { CheckCircle2, Eye, EyeOff, KeyRound, LogOut, ShieldCheck } from "lucide-react";

import { crmPost } from "../crm/api";
import { performAdminLogout } from "../lib/adminLogout";

/** Mirror of the server's `password_hashing._MIN_LENGTH`. */
export const PASSWORD_MIN_LENGTH = 8;

/** PURE — the checks the form shows as ticks. Only `length` is enforced by the server. */
export function passwordChecks(next: string, current: string, confirm: string) {
  return [
    { key: "length", ok: next.length >= PASSWORD_MIN_LENGTH, label: `At least ${PASSWORD_MIN_LENGTH} characters`, required: true },
    { key: "different", ok: !!next && next !== current, label: "Different from the temporary password", required: true },
    { key: "match", ok: !!next && next === confirm, label: "Both new passwords match", required: true },
    { key: "mixed", ok: /[a-z]/.test(next) && /[A-Z]/.test(next), label: "Upper and lower case letters", required: false },
    { key: "number", ok: /\d/.test(next) && /[^A-Za-z0-9]/.test(next), label: "A number and a symbol", required: false },
  ];
}

const inputBase =
  "h-11 w-full rounded-control border border-subtle bg-surface-1 px-3 pr-10 text-sm text-primary outline-none transition-colors duration-micro focus:border-brand-500";

function PasswordInput({ id, label, value, onChange, autoComplete }: {
  id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold text-secondary">{label}</label>
      <div className="relative">
        <input id={id} type={show ? "text" : "password"} autoComplete={autoComplete} className={inputBase}
          value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-primary">
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}

export function ForcePasswordChange({ name }: { name?: string | null }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const checks = useMemo(() => passwordChecks(next, current, confirm), [next, current, confirm]);
  const ready = !!current && checks.every((c) => !c.required || c.ok);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setErr("");
    try {
      await crmPost("/api/me/change-password", { current_password: current, new_password: next });
      setDone(true);
      setTimeout(() => window.location.reload(), 900);
    } catch (ex: any) {
      setErr(ex?.message || "Could not change the password");
      setBusy(false);
    }
  };

  return (
    <div className="relative isolate grid min-h-screen place-items-center bg-surface-0 px-4 py-10 text-primary">
      <div aria-hidden className="fx-aurora" />
      <div className="w-full max-w-md overflow-hidden rounded-modal border border-subtle bg-surface-1 shadow-modal">
        <div className="bg-gradient-to-br from-indigo-600 via-blue-600 to-sky-500 px-6 py-6 text-[#fff]">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#fff]/15 ring-1 ring-[#fff]/25">
            <KeyRound size={20} aria-hidden />
          </span>
          <p className="mt-4 text-[11px] font-bold uppercase tracking-widest text-[#fff]/80">One step before you start</p>
          <h1 className="mt-1 text-xl font-bold">Set your own password</h1>
          <p className="mt-1 text-sm text-[#fff]/85">
            {name ? `${name}, an` : "An"} Admin reset your password. Choose one only you know — the
            temporary password stops working once you do.
          </p>
        </div>
        {done ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <CheckCircle2 size={36} className="text-success" aria-hidden />
            <p className="text-base font-semibold">Password changed</p>
            <p className="text-sm text-muted">Opening your workspace…</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 px-6 py-6">
            <PasswordInput id="fpc-current" label="Temporary password (from the Admin)" value={current}
              onChange={setCurrent} autoComplete="current-password" />
            <PasswordInput id="fpc-new" label="New password" value={next} onChange={setNext} autoComplete="new-password" />
            <PasswordInput id="fpc-confirm" label="Confirm new password" value={confirm} onChange={setConfirm}
              autoComplete="new-password" />
            <ul className="grid gap-1.5 rounded-xl border border-subtle bg-surface-2 p-3 text-xs">
              {checks.map((c) => (
                <li key={c.key} className={`flex items-center gap-2 ${c.ok ? "text-success" : c.required ? "text-secondary" : "text-muted"}`}>
                  <CheckCircle2 size={14} className={c.ok ? "" : "opacity-30"} aria-hidden />
                  {c.label}{!c.required && <span className="text-muted">· recommended</span>}
                </li>
              ))}
            </ul>
            {err && <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">{err}</p>}
            <button type="submit" disabled={!ready || busy}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-control bg-gradient-to-r from-indigo-600 to-blue-600 text-sm font-semibold text-[#fff] shadow transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
              <ShieldCheck size={16} aria-hidden /> {busy ? "Saving…" : "Set password and continue"}
            </button>
            <button type="button" onClick={() => void performAdminLogout()}
              className="inline-flex w-full items-center justify-center gap-1.5 text-xs font-semibold text-muted hover:text-primary">
              <LogOut size={13} aria-hidden /> Sign out instead
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
