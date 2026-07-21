/** Persistent logged-in-user block for the bottom of the CRM sidebar.
 * Avatar (photo or initials) + name + email, with a popover menu. Collapses to
 * avatar-only via the `compact` prop (mobile / collapsed rail). */
import { useEffect, useRef, useState } from "react";
import { LogOut, Settings as SettingsIcon, UserRound } from "lucide-react";
import { useMe } from "../CrmApp";
import { crmGet } from "../api";
import { crmNavigate } from "../routerHooks";
import { performAdminLogout } from "../../lib/adminLogout";
import { Avatar } from "./Avatar";

export function SidebarUserBlock({ compact = false }: { compact?: boolean }) {
  const me = useMe();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [ver, setVer] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    crmGet<{ avatar_url: string | null }>("/api/me/profile")
      .then((r) => { if (!cancelled) setAvatarUrl(r.data?.avatar_url ?? null); })
      .catch(() => {});
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if ("avatar_url" in detail) { setAvatarUrl(detail.avatar_url ?? null); setVer((v) => v + 1); }
    };
    window.addEventListener("karnex:profile-updated", onUpdate);
    return () => { cancelled = true; window.removeEventListener("karnex:profile-updated", onUpdate); };
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const src = avatarUrl ? `${avatarUrl}?v=${ver}` : null;
  const go = (path: string) => { setOpen(false); crmNavigate(path); };

  return (
    <div ref={ref} className="relative">
      {open && (
        <div
          role="menu"
          className={`absolute z-40 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900 ${
            compact ? "right-0 top-full mt-2" : "bottom-full left-0 mb-2"
          }`}
        >
          <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800" onClick={() => go("profile")}>
            <UserRound size={15} /> My Profile
          </button>
          <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800" onClick={() => go("settings")}>
            <SettingsIcon size={15} /> Settings
          </button>
          <button role="menuitem" className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 dark:border-slate-800 dark:text-rose-400 dark:hover:bg-rose-950/40" onClick={() => { setOpen(false); void performAdminLogout(); }}>
            <LogOut size={15} /> Log out
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={compact ? `${me.full_name} · ${me.email}` : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white/70 p-2 text-left shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:bg-slate-800 ${compact ? "justify-center" : ""}`}
      >
        <Avatar name={me.full_name} src={src} size={compact ? 32 : 36} />
        {!compact && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-slate-800 dark:text-slate-100">{me.full_name || me.username}</span>
            <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{me.email}</span>
          </span>
        )}
      </button>
    </div>
  );
}
