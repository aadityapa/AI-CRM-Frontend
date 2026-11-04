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
import { AlertTriangle, Check, ClipboardCopy, ExternalLink, Globe2, Megaphone } from "lucide-react";

import { crmGet, crmPut } from "../api";
import { channelPost, channelUrl } from "../lib/careersLink";

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
  can_edit: boolean;
};

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
  const post = data ? channelPost(data.post_text, data.url, src) : "";
  const listed = useMemo(() => (data?.positions || []).filter((p) => p.listed), [data]);
  const sourceLabel = data?.channels.find((c) => c.key === src)?.label || "Careers page";

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
              {[...data.channels, { key: "", label: "Anywhere" }].map((c) => (
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
              <p className="text-xs text-muted">The post names the first three positions; the link shows them all. Customer names never appear.</p>
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

          <p className="flex gap-2 rounded-control bg-warning-soft p-3 text-sm text-primary">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
            <span>
              A position appears here by itself once RMG approves it (open for sourcing) and drops off when it is filled,
              closed or put on hold. Candidates see the RMG JD. Every application lands in that position's Applied
              Candidates at Sourcing, marked “Applied on the careers page · {sourceLabel}” — already interested, so no
              opening email is needed — and the position's TAs are told. TA sends them for Technical Screening.
            </span>
          </p>
        </div>
      )}
    </Modal>
  );
}
