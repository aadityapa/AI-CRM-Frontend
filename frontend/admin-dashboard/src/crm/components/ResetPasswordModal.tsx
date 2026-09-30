/**
 * ResetPasswordModal — Admin/CEO sets or generates a user's password (23 Sep 2026).
 *
 * `POST /api/users/{id}/reset-password`. Two modes: "Generate" asks the server
 * for a temporary password and shows it ONCE with a copy button (it is never
 * stored in clear and never shown again), or "Set" takes a password the admin
 * types. The server enforces the same policy as self-service reset and refuses
 * an admin resetting their own account here (that is Change password).
 */
import { useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { crmPost } from "../api";
import { Modal, btnPrimary, btnSecondary, inputCls } from "./ui";

type Target = { id: number; full_name?: string; username?: string; email?: string };
type Result = { generated: boolean; temporary_password: string | null; username: string; email: string };

export function ResetPasswordModal({
  user,
  onClose,
  notify,
}: {
  user: Target;
  onClose: () => void;
  notify: (msg: string, kind?: "ok" | "err") => void;
}) {
  const [mode, setMode] = useState<"generate" | "set">("generate");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);

  const who = user.full_name || user.username || user.email || `#${user.id}`;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await crmPost<Result>(`/api/users/${user.id}/reset-password`, {
        new_password: mode === "set" ? password : null,
      });
      setResult(res.data);
      notify(res.message || "Password updated");
    } catch (err: any) {
      setError(err?.message || "Could not reset the password");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!result?.temporary_password) return;
    try {
      await navigator.clipboard.writeText(result.temporary_password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the value is on screen to select */
    }
  };

  return (
    <Modal
      title={`Reset password — ${who}`}
      onClose={onClose}
      footer={
        result ? (
          <button className={btnPrimary} onClick={onClose}>Done</button>
        ) : (
          <>
            <button className={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
            <button className={btnPrimary} onClick={submit} disabled={busy || (mode === "set" && password.length < 8)}>
              <KeyRound size={14} /> {busy ? "Saving…" : mode === "generate" ? "Generate & save" : "Set password"}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          {result.generated && result.temporary_password ? (
            <>
              <p className="text-sm text-secondary">
                Temporary password for <strong className="text-primary">{result.username}</strong>. It is shown
                <strong> once</strong> — copy it now and share it securely. Ask them to change it after signing in.
              </p>
              <div className="flex items-center gap-2 rounded-control border border-subtle bg-surface-2 px-3 py-2">
                <code className="flex-1 select-all font-mono text-base tracking-wide text-primary">{result.temporary_password}</code>
                <button className={btnSecondary} onClick={copy} title="Copy">
                  {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-secondary">
              Password updated for <strong className="text-primary">{result.username}</strong>. They can sign in with it now.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-secondary">
            Choose how to reset the password for <strong className="text-primary">{who}</strong>
            {user.email ? <span className="text-muted"> ({user.email})</span> : null}.
          </p>
          <div className="inline-flex overflow-hidden rounded-control border border-subtle" role="radiogroup">
            {(["generate", "set"] as const).map((m, i) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                className={`px-3 py-1.5 text-xs font-semibold ${i > 0 ? "border-l border-subtle" : ""} ${
                  mode === m ? "bg-brand-600 text-white" : "bg-surface-1 text-secondary hover:bg-surface-2"
                }`}
                onClick={() => setMode(m)}
              >
                {m === "generate" ? "Generate a temporary password" : "Set a password"}
              </button>
            ))}
          </div>
          {mode === "set" && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-secondary">New password</span>
              <input
                type="text"
                className={inputCls}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters, letters and numbers"
                autoComplete="new-password"
              />
            </label>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
