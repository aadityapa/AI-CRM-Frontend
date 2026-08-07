/** Self-service profile page: identity, avatar upload, editable fields, change password. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, KeyRound, Loader2, Trash2, Upload } from "lucide-react";
import { crmDelete, crmGet, crmPatch, crmPost, crmUpload } from "../api";
import { Avatar } from "../components/Avatar";
import {
  ErrorBox, Field, Spinner, StatusBadge,
  btnDanger, btnPrimary, btnSecondary, inputCls, useToast,
} from "../components/ui";

type Profile = {
  id: number;
  username: string;
  full_name: string;
  email: string;
  role: string | null;
  roles: string[];
  date_joined: string | null;
  last_login: string | null;
  phone: string | null;
  job_title: string | null;
  department: string | null;
  timezone: string | null;
  avatar_url: string | null;
};

type Editable = { full_name: string; phone: string; job_title: string; department: string; timezone: string };

const TIMEZONES = [
  "", "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "Europe/Berlin",
  "America/New_York", "America/Chicago", "America/Los_Angeles", "UTC",
];
const MAX_AVATAR_MB = 5;
const ACCEPT = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

function editableFrom(p: Profile): Editable {
  return {
    full_name: p.full_name || "",
    phone: p.phone || "",
    job_title: p.job_title || "",
    department: p.department || "",
    timezone: p.timezone || "",
  };
}

function fmtDate(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

function notifyProfileChanged(patch: { full_name?: string; avatar_url?: string | null }) {
  window.dispatchEvent(new CustomEvent("karnex:profile-updated", { detail: patch }));
}

export function ProfilePage() {
  const [toast, showToast] = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState<Editable | null>(null);
  const [saving, setSaving] = useState(false);
  const [avatarVer, setAvatarVer] = useState(0);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await crmGet<Profile>("/api/me/profile");
      setProfile(res.data);
      setForm(editableFrom(res.data));
    } catch (e: any) {
      setError(e?.message || "Failed to load profile");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => {
    if (!profile || !form) return false;
    const base = editableFrom(profile);
    return (Object.keys(base) as (keyof Editable)[]).some((k) => base[k] !== form[k]);
  }, [profile, form]);

  // Warn on browser navigation with unsaved edits.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const set = (k: keyof Editable, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const save = async () => {
    if (!form || !profile) return;
    if (!form.full_name.trim()) { showToast("Full name is required", "err"); return; }
    setSaving(true);
    // Optimistic: reflect immediately, roll back on failure.
    const prev = profile;
    const optimistic = { ...profile, ...form };
    setProfile(optimistic);
    try {
      const res = await crmPatch<Profile>("/api/me/profile", {
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || null,
        job_title: form.job_title.trim() || null,
        department: form.department.trim() || null,
        timezone: form.timezone || null,
      });
      setProfile(res.data);
      setForm(editableFrom(res.data));
      notifyProfileChanged({ full_name: res.data.full_name });
      showToast("Profile saved");
    } catch (e: any) {
      setProfile(prev); // rollback
      setForm(editableFrom(prev));
      showToast(e?.message || "Save failed", "err");
    } finally {
      setSaving(false);
    }
  };

  const discard = () => profile && setForm(editableFrom(profile));

  if (error && !profile) return <ErrorBox error={error} onRetry={load} />;
  if (!profile || !form) return <Spinner label="Loading your profile…" />;

  const avatarSrc = profile.avatar_url ? `${profile.avatar_url}?v=${avatarVer}` : null;

  return (
    <div className="mx-auto max-w-4xl pb-24">
      {toast}
      <h1 className="text-display mb-1 text-xl font-bold text-primary">My Profile</h1>
      <p className="mb-6 text-sm text-muted">Manage your personal details, photo and password.</p>

      <AvatarCard
        name={profile.full_name}
        src={avatarSrc}
        onUploaded={(url) => {
          setProfile((p) => (p ? { ...p, avatar_url: url } : p));
          setAvatarVer((v) => v + 1);
          notifyProfileChanged({ avatar_url: url });
        }}
        onRemoved={() => {
          setProfile((p) => (p ? { ...p, avatar_url: null } : p));
          setAvatarVer((v) => v + 1);
          notifyProfileChanged({ avatar_url: null });
        }}
        toast={showToast}
      />

      <section className="mt-6 rounded-card border border-subtle bg-surface-1 p-6 shadow-raised">
        <h2 className="fx-hairline-b mb-4 pb-2 text-base font-bold text-primary">Details</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name" required>
            <input className={inputCls} value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
          </Field>
          <Field label="Email (read-only)">
            <input className={`${inputCls} opacity-70`} value={profile.email} readOnly title="Contact an admin to change your login email" />
          </Field>
          <Field label="Phone">
            <input className={inputCls} value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="e.g. +91 98765 43210" />
          </Field>
          <Field label="Job title">
            <input className={inputCls} value={form.job_title} onChange={(e) => set("job_title", e.target.value)} placeholder="e.g. Talent Acquisition Lead" />
          </Field>
          <Field label="Department">
            <input className={inputCls} value={form.department} onChange={(e) => set("department", e.target.value)} placeholder="e.g. Recruitment" />
          </Field>
          <Field label="Timezone">
            <select className={inputCls} value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz || "— select —"}</option>)}
              {form.timezone && !TIMEZONES.includes(form.timezone) && <option value={form.timezone}>{form.timezone}</option>}
            </select>
          </Field>
        </div>
      </section>

      <section className="mt-6 rounded-card border border-subtle bg-surface-1 p-6 shadow-raised">
        <h2 className="fx-hairline-b mb-4 pb-2 text-base font-bold text-primary">Account</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Roles / Permissions</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {profile.roles.length ? profile.roles.map((r) => <StatusBadge key={r} status={r} />) : <span className="text-sm text-muted">{profile.role || "—"}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Username</dt>
            <dd className="mt-1 text-sm text-primary">{profile.username}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Date joined</dt>
            <dd className="mt-1 text-sm text-primary">{fmtDate(profile.date_joined)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Last login</dt>
            <dd className="mt-1 text-sm text-primary">{fmtDate(profile.last_login)}</dd>
          </div>
        </dl>
      </section>

      <ChangePasswordCard toast={showToast} />

      {/* Sticky save bar — only when there are unsaved changes (opaque surface, no glass) */}
      {dirty && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-subtle bg-surface-1">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <span className="text-sm font-semibold text-secondary">You have unsaved changes</span>
            <div className="flex gap-2">
              <button className={btnSecondary} onClick={discard} disabled={saving}>Discard</button>
              <button className={btnPrimary} onClick={save} disabled={saving}>
                {saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AvatarCard({
  name, src, onUploaded, onRemoved, toast,
}: {
  name: string;
  src: string | null;
  onUploaded: (url: string) => void;
  onRemoved: () => void;
  toast: (m: string, k?: "ok" | "err") => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [removing, setRemoving] = useState(false);

  const handleFile = async (file: File) => {
    if (!ACCEPT.includes(file.type)) { toast("Photo must be JPG, PNG or WEBP", "err"); return; }
    if (file.size > MAX_AVATAR_MB * 1024 * 1024) { toast(`Photo must be under ${MAX_AVATAR_MB} MB`, "err"); return; }
    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl);
    setProgress(0);
    try {
      const res = await crmUpload<{ avatar_url: string }>("/api/me/avatar", file, {}, (p) => setProgress(p));
      onUploaded(res.data.avatar_url);
      toast("Photo updated");
    } catch (e: any) {
      toast(e?.message || "Upload failed", "err");
    } finally {
      setProgress(null);
      setPreview(null);
      URL.revokeObjectURL(localUrl);
    }
  };

  const remove = async () => {
    setRemoving(true);
    try {
      await crmDelete("/api/me/avatar");
      onRemoved();
      toast("Photo removed");
    } catch (e: any) {
      toast(e?.message || "Remove failed", "err");
    } finally {
      setRemoving(false);
    }
  };

  const shown = preview || src;

  return (
    <section className="rounded-card border border-subtle bg-surface-1 p-6 shadow-raised">
      <h2 className="fx-hairline-b mb-4 pb-2 text-base font-bold text-primary">Photo</h2>
      <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
        <div className="relative">
          <Avatar name={name} src={shown} size={88} />
          {progress !== null && (
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-backdrop text-xs font-bold text-white">
              {progress}%
            </div>
          )}
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
          className={`flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed px-4 py-6 text-center transition-colors duration-micro ease-smooth ${
            dragOver ? "border-brand-500 bg-surface-2" : "border-subtle hover:border-brand-400"
          }`}
        >
          <Upload size={18} className="text-brand-500" />
          <div className="text-sm font-semibold text-secondary">Drag &amp; drop or click to upload</div>
          <div className="text-xs text-muted">JPG, PNG or WEBP · max {MAX_AVATAR_MB} MB</div>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button className={btnSecondary} onClick={() => inputRef.current?.click()}>
          <Camera size={15} /> Choose photo
        </button>
        {src && (
          <button className={btnDanger} onClick={remove} disabled={removing}>
            <Trash2 size={15} /> {removing ? "Removing…" : "Remove photo"}
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT.join(",")}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
      />
    </section>
  );
}

function scorePassword(pw: string): { score: number; label: string; color: string } {
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  if (pw.length >= 12) s = Math.min(4, s + 1);
  const map = [
    { label: "Very weak", color: "bg-danger" },
    { label: "Weak", color: "bg-danger" },
    { label: "Fair", color: "bg-warning" },
    { label: "Good", color: "bg-success" },
    { label: "Strong", color: "bg-success" },
  ];
  const idx = Math.min(4, s);
  return { score: idx, ...map[idx] };
}

function ChangePasswordCard({ toast }: { toast: (m: string, k?: "ok" | "err") => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const strength = scorePassword(next);
  const mismatch = confirm.length > 0 && confirm !== next;

  const submit = async () => {
    if (!current) { toast("Enter your current password", "err"); return; }
    if (next.length < 6) { toast("New password must be at least 6 characters", "err"); return; }
    if (next !== confirm) { toast("New passwords do not match", "err"); return; }
    setBusy(true);
    try {
      await crmPost("/api/me/change-password", { current_password: current, new_password: next });
      toast("Password changed");
      setCurrent(""); setNext(""); setConfirm("");
    } catch (e: any) {
      toast(e?.message || "Could not change password", "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 rounded-card border border-subtle bg-surface-1 p-6 shadow-raised">
      <h2 className="fx-hairline-b mb-4 flex items-center gap-2 pb-2 text-base font-bold text-primary">
        <KeyRound size={16} /> Change password
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Current password">
          <input type="password" autoComplete="current-password" className={inputCls} value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password">
          <input type="password" autoComplete="new-password" className={inputCls} value={next} onChange={(e) => setNext(e.target.value)} />
          {next && (
            <div className="mt-1.5">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2 ring-1 ring-inset ring-subtle">
                <div className={`h-full ${strength.color} transition-all duration-micro ease-smooth`} style={{ width: `${(strength.score + 1) * 20}%` }} />
              </div>
              <div className="mt-1 text-xs font-semibold text-muted">{strength.label}</div>
            </div>
          )}
        </Field>
        <Field label="Confirm new password" error={mismatch ? "Passwords do not match" : ""}>
          <input type="password" autoComplete="new-password" className={inputCls} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
      </div>
      {/* Secondary by design — "Save changes" (sticky bar) is the page's one primary action. */}
      <div className="mt-4 flex justify-end">
        <button className={btnSecondary} onClick={submit} disabled={busy}>
          {busy ? "Updating…" : "Update password"}
        </button>
      </div>
    </section>
  );
}
