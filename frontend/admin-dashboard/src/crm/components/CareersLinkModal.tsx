/**
 * Careers link (3 Nov 2026, user ask: "one unique link for every active position that
 * our RMG can post on LinkedIn; it follows Orbit; the candidate sees the RMG JD; an
 * application lands with TA at Sourcing, already interested").
 *
 * `CareersLinkButton` sits in the Opportunities header (Sales / RMG / GM / Admin strip
 * and TA's position list). It opens `CareersLinkModal`, which reads
 * `GET /api/careers/overview`: the ONE public link (`/careers`, with `?src=` per channel
 * so TA sees where an applicant came from), a ready-to-paste post, and every live
 * position with an "On the careers page" switch for RMG / GM / Sales Head
 * (`PUT /api/careers/positions/{id}`). Nothing is copied into the page by hand — a
 * position appears once RMG approves it and drops off when it is filled, closed or held.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, Check, ClipboardCopy, ExternalLink, Globe2, Megaphone } from "lucide-react";

import { crmGet, crmPut } from "../api";
import { buildPost, channelPost, channelUrl } from "../lib/careersLink";

export { channelPost, channelUrl };
import { HERO_BTN } from "./PageHeader";
import { DialogHero } from "./dialogKit";
import { Modal, btnPrimary, btnSecondary } from "./ui";

type ToastFn = (msg: string, kind?: "ok" | "err") => void;

export type CareersPosition = {
  id: number;
  code: string;
  title: string;
  city: string;
  location: string;
  experience: string;
  work_mode: string;
  openings: number;
  listed: boolean;
  applications: number;
  opportunity_id: number;
};

export type CareersOverview = {
  url: string;
  base_reach?: "public" | "private" | "unknown";
  post_text: string;
  positions: CareersPosition[];
  applications_total: number;
  channels: { key: string; label: string }[];
  direct_channel?: { key: string; label: string };
  by_channel?: ChannelStat[];
  can_edit: boolean;
};

/** Where careers applications came from (5 Nov 2026, `services/careers.channel_stats`). */
export type ChannelStat = {
  key: string; label: string; applications: number; last_30_days: number;
  in_process: number; joined: number; closed: number; moved_on_pct: number | null;
};

const CHANNEL_DOT: Record<string, string> = {
  linkedin: "bg-[#0a66c2]", naukri: "bg-[#4a90e2]", whatsapp: "bg-[#25d366]", indeed: "bg-[#2164f3]", karnex: "bg-brand-600",
};

/** The best channel by people who moved on, else by applications; null with none. PURE. */
export function bestChannel(rows: ChannelStat[]): ChannelStat | null {
  const used = rows.filter((r) => r.applications > 0);
  if (!used.length) return null;
  return [...used].sort((a, b) => (b.in_process + b.joined) - (a.in_process + a.joined) || b.applications - a.applications)[0];
}

/** "Which platform helps us most" — one bar per channel (5 Nov 2026). */
function ChannelStats({ rows }: { rows: ChannelStat[] }) {
  const max = Math.max(1, ...rows.map((r) => r.applications));
  const best = bestChannel(rows);
  return (
    <section className="rounded-card border border-default p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-primary"><BarChart3 size={16} aria-hidden /> Where applications come from</h3>
        {best && (
          <span className="rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-semibold text-success">
            Most helpful so far: {best.label}
          </span>
        )}
      </div>
      <div className="mt-3 space-y-2">
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-[9rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
            <span className="flex items-center gap-2 truncate font-semibold text-primary">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${CHANNEL_DOT[r.key] || "bg-slate-400"}`} aria-hidden />{r.label}
            </span>
            <span className="h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <span className={`block h-full rounded-full ${CHANNEL_DOT[r.key] || "bg-slate-400"}`} style={{ width: `${(100 * r.applications) / max}%` }} />
            </span>
            <span className="whitespace-nowrap text-xs text-secondary tabular-nums">
              <b className="text-primary">{r.applications}</b> applied
              {r.last_30_days > 0 && <> · {r.last_30_days} in 30 d</>}
              {(r.in_process + r.joined) > 0 && <> · {r.in_process + r.joined} moved on</>}
              {r.joined > 0 && <> · {r.joined} joined</>}
              {r.moved_on_pct != null && <> · {r.moved_on_pct}%</>}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">
        “Moved on” = past TA's Sourcing and still in process, or joined. Applications from the plain link (no channel tag)
        count as Karnex careers page.
      </p>
    </section>
  );
}

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export function CareersLinkButton({ toast }: { toast: ToastFn }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={HERO_BTN} onClick={() => setOpen(true)}
        title="One public link for every open position — post it on LinkedIn">
        <Globe2 size={16} aria-hidden /> Careers link
      </button>
      {open && <CareersLinkModal toast={toast} onClose={() => setOpen(false)} />}
    </>
  );
}

export function CareersLinkModal({ toast, onClose }: { toast: ToastFn; onClose: () => void }) {
  const [data, setData] = useState<CareersOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [src, setSrc] = useState("linkedin");
  const [copied, setCopied] = useState<"link" | "post" | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await crmGet<CareersOverview>("/api/careers/overview");
      setData(res.data); setError(null);
    } catch (e: any) {
      setError(e?.message || "Could not load the careers link");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const link = data ? channelUrl(data.url, src) : "";
  // "Open page" previews on the server this dashboard runs on (localhost while testing),
  // so it works before the public site is deployed; "Copy link" always copies the public one.
  const here = typeof window !== "undefined" ? window.location.origin : "";
  const previewUrl = here ? `${here}/careers` : link;
  const linkHost = (() => { try { return new URL(link).origin; } catch { return ""; } })();
  const elsewhere = Boolean(data && here && linkHost && linkHost !== here);
  const listed = useMemo(() => (data?.positions || []).filter((p) => p.listed), [data]);
  // The post follows the switches: every position switched on is named (5 Nov 2026).
  const post = data ? channelPost(buildPost(listed, data.url), data.url, src) : "";
  const directLabel = data?.direct_channel?.label || "Karnex careers page";
  const sourceLabel = data?.channels.find((c) => c.key === src)?.label || directLabel;

  const doCopy = async (what: "link" | "post") => {
    const ok = await copy(what === "link" ? link : post);
    if (ok) { setCopied(what); window.setTimeout(() => setCopied(null), 1800); }
    else toast("Could not copy — select the text and copy it", "err");
  };

  const toggle = async (p: CareersPosition) => {
    setBusy(p.id);
    try {
      const res = await crmPut<{ listed: boolean }>(`/api/careers/positions/${p.id}`, { listed: !p.listed });
      toast(res.message || "Saved");
      await load();
    } catch (e: any) {
      toast(e?.message || "Could not change it", "err");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      title="Careers link"
      onClose={onClose}
      xl
      hero={(
        <DialogHero tone="brand" icon={Globe2} eyebrow="Opportunities ▸ Careers link"
          title="Public careers link"
          subtitle="One link for every open position. Post it once — it stays up to date by itself."
          chips={data ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ffffff] px-3 py-1 text-xs font-bold text-[#1e3a8a]">
              <span className="h-2 w-2 rounded-full bg-[#16a34a]" aria-hidden /> Live · {listed.length} position{listed.length === 1 ? "" : "s"}
              {data.applications_total > 0 && <> · {data.applications_total} applied</>}
            </span>
          ) : null}
        />
      )}
    >
      {error && <p className="rounded-control bg-danger-soft p-3 text-sm text-danger">{error}</p>}
      {!data && !error && <p className="text-sm text-secondary">Loading…</p>}
      {data && (
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-secondary">Where will you post it?</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Where will you post it">
              {[...data.channels, { key: "", label: directLabel }].map((c) => (
                <button key={c.key || "any"} type="button" aria-pressed={src === c.key}
                  onClick={() => { setSrc(c.key); setCopied(null); }}
                  className={`min-h-9 rounded-full px-4 text-sm font-semibold ring-1 ring-inset transition-colors ${
                    src === c.key ? "bg-brand-700 text-white ring-brand-700" : "bg-surface-1 text-brand-800 ring-brand-200 hover:bg-brand-50"}`}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <label htmlFor="careers-link" className="sr-only">Careers link</label>
            <input id="careers-link" readOnly value={link}
              className="min-h-11 min-w-0 flex-1 rounded-control border border-default bg-surface-2 px-3 font-mono text-sm text-primary"
              onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className={btnPrimary} onClick={() => void doCopy("link")}>
              {copied === "link" ? <Check size={16} aria-hidden /> : <ClipboardCopy size={16} aria-hidden />}
              {copied === "link" ? "Copied" : "Copy link"}
            </button>
            <a className={btnSecondary} href={previewUrl} target="_blank" rel="noopener noreferrer"
              title={elsewhere ? `Opens the page on this server (${here})` : undefined}>
              <ExternalLink size={16} aria-hidden /> Open page
            </a>
          </div>

          {elsewhere && (
            <p className="text-xs text-muted">
              <b>Open page</b> shows the page on this server ({here}). The link you copy uses {linkHost} —
              it opens only once that site runs this version of Orbit.
            </p>
          )}

          {data.base_reach === "private" && (
            <p className="flex items-start gap-2 rounded-control bg-warning-soft p-3 text-sm text-warning">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
              This link uses an office-network address, so people outside cannot open it. Ask Admin to set the public
              address in Settings ▸ Organisation ▸ Email &amp; links before posting.
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="flex min-w-0 flex-col gap-2 rounded-card border border-default p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-bold text-primary">
                  <Megaphone size={16} aria-hidden /> Ready-to-paste post
                </h3>
                <button type="button" className={btnSecondary} onClick={() => void doCopy("post")}>
                  {copied === "post" ? <Check size={14} aria-hidden /> : <ClipboardCopy size={14} aria-hidden />}
                  {copied === "post" ? "Copied" : "Copy post"}
                </button>
              </div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-control bg-surface-2 p-3 font-sans text-sm leading-6 text-secondary">{post}</pre>
              <p className="text-xs text-muted">The post names every position switched on at the right — switch one off and it leaves the post. Customer names never appear.</p>
            </section>

            <section className="flex min-w-0 flex-col gap-1 rounded-card border border-default p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-bold text-primary">On the page now</h3>
                {data.can_edit && <span className="text-xs text-muted">Switch off to hide one position</span>}
              </div>
              {data.positions.length === 0 && (
                <p className="py-3 text-sm text-secondary">No position is open for sourcing right now.</p>
              )}
              <ul className="max-h-80 divide-y divide-default overflow-auto">
                {data.positions.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className={`block truncate text-sm font-semibold ${p.listed ? "text-primary" : "text-muted line-through"}`}>{p.title}</span>
                      <span className="block truncate text-xs text-secondary">
                        {[p.code, p.city !== "Other" ? p.city : "", p.experience, `${p.openings} opening${p.openings === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                        {p.applications > 0 && <> · <b>{p.applications} applied</b></>}
                      </span>
                    </span>
                    {data.can_edit ? (
                      <button type="button" role="switch" aria-checked={p.listed} disabled={busy === p.id}
                        aria-label={`Show ${p.title} on the careers page`} onClick={() => void toggle(p)}
                        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${p.listed ? "bg-brand-600" : "bg-surface-3"}`}>
                        <span className={`absolute top-1 h-5 w-5 rounded-full bg-[#ffffff] shadow transition-all ${p.listed ? "left-6" : "left-1"}`} />
                      </button>
                    ) : (
                      <span className={`shrink-0 text-xs font-semibold ${p.listed ? "text-success" : "text-muted"}`}>{p.listed ? "Listed" : "Hidden"}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {data.by_channel && data.by_channel.length > 0 && <ChannelStats rows={data.by_channel} />}

          <p className="flex gap-2 rounded-control bg-warning-soft p-3 text-sm text-primary">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
            <span>
              A position appears here by itself once RMG approves it (open for sourcing) and drops off when it is filled,
              closed or put on hold. Candidates see the RMG JD. Every application lands in that position's Applied
              Candidates at Sourcing, marked “Applied via {sourceLabel}” — already interested, so no
              opening email is needed — and the position's TAs are told. TA sends them for Technical Screening.
            </span>
          </p>
        </div>
      )}
    </Modal>
  );
}
