/**
 * ApplyLinkCard (19 Oct 2026, user ask: "when RMG approves an opportunity it goes to
 * TA for sourcing — generate a link with a form TA can put on Naukri, LinkedIn or any
 * job portal; the candidate's resume & details come straight into that position at
 * Sourcing, then TA moves them to Technical Screening. Give this link in the
 * Opportunity Details section").
 *
 * Lives on the opportunity's Details tab. Reads `GET /api/requirements/{id}/apply-link`
 * (TA · RMG · Sales · Sales Head · GM by grant — anyone else gets a 403 and the card
 * simply isn't drawn). The link is the existing signed public form (`/apply/{token}`,
 * B-V2 routers/crm/apply.py): every submission becomes a Resume + Candidate + a
 * CandidateProfile at SOURCING on this opportunity, and the position's TAs are told.
 *
 *  - before RMG approval: the card says the link opens once RMG approves (no link yet);
 *  - open for sourcing: the link · Copy · Open form · Copy job post (ready-to-paste text
 *    for Naukri / LinkedIn) · Share on LinkedIn / WhatsApp, and how many applied;
 *  - on hold / fulfilled / closed: the form tells candidates applications are closed.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, ClipboardCopy, ExternalLink, Link2, Lock, Megaphone, Share2 } from "lucide-react";

import { crmGet } from "../api";
import { CrmLink } from "../routerHooks";
import { useHasRole } from "../CrmApp";
import { btnPrimary, btnSecondary } from "./ui";

type ToastFn = (msg: string, kind?: "ok" | "err") => void;

export type ApplyLinkData = {
  apply_url: string;
  is_open: boolean;
  requirement_status: string;
  req_number?: string | null;
  title?: string | null;
  applications?: number;
  post_text?: string;
  /** Where the link's address comes from (20 Oct 2026): the link is built on every
      read, so after a deploy it follows Settings ▸ Email & links ▸ Public base URL. */
  base_url?: string;
  base_reach?: "public" | "private" | "unknown";
  base_source?: "settings" | "environment" | "request";
};

/** Requirement states before RMG has approved the position for sourcing. */
const PRE_APPROVAL = new Set([
  "Draft", "Pending_Sales_Head_Approval", "Sales_Head_Rejected",
  "Pending_Engineering_Review", "Engineering_Rejected", "Pending_HM_Review",
]);

export type ApplyLinkState = "pending" | "open" | "closed";

/** PURE — what the card shows for a requirement status. */
export function applyLinkState(status: string | null | undefined, isOpen?: boolean): ApplyLinkState {
  if (isOpen) return "open";
  if (!status || PRE_APPROVAL.has(status)) return "pending";
  return "closed";
}

/** PURE — share URLs for the portals that accept one (Naukri has none: paste the post). */
export function shareLinks(url: string, postText?: string) {
  const enc = encodeURIComponent;
  return {
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`,
    whatsapp: `https://wa.me/?text=${enc(postText || url)}`,
  };
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ApplyLinkCard({ requirementId, toast }: { requirementId: number; toast?: ToastFn }) {
  const [data, setData] = useState<ApplyLinkData | null>(null);
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState<"" | "link" | "post">("");
  const canSetBase = useHasRole();

  const load = useCallback(async () => {
    try {
      const res = await crmGet<ApplyLinkData>(`/api/requirements/${requirementId}/apply-link`);
      setData(res.data || null);
      setHidden(false);
    } catch {
      setHidden(true); // no access (or no requirement yet) — nothing to show
    }
  }, [requirementId]);

  useEffect(() => { void load(); }, [load]);

  if (hidden || !data) return null;
  const state = applyLinkState(data.requirement_status, data.is_open);
  const share = shareLinks(data.apply_url, data.post_text);

  const doCopy = async (what: "link" | "post") => {
    const ok = await copy(what === "link" ? data.apply_url : (data.post_text || data.apply_url));
    if (ok) {
      setCopied(what);
      window.setTimeout(() => setCopied(""), 2000);
      toast?.(what === "link" ? "Application link copied" : "Job post copied — paste it on the portal");
    } else {
      toast?.("Copy blocked by the browser — select the link and copy it", "err");
    }
  };

  return (
    <div className="rounded-card border border-subtle bg-surface-1 p-6 shadow-raised" data-testid="apply-link-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-brand-600/10 text-brand-600 dark:text-brand-300">
            <Link2 size={18} aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-bold text-primary">Candidate application link</h2>
            <p className="mt-0.5 text-sm text-muted">
              Post this on Naukri, LinkedIn or any job portal. Every application lands in this
              position&apos;s Applicants at <strong className="text-primary">Sourcing</strong> — review it, then
              move the candidate to Technical Screening.
            </p>
          </div>
        </div>
        {state === "open" ? (
          <span className="rounded-full bg-success-soft px-2.5 py-1 text-xs font-semibold text-success">
            Accepting applications{typeof data.applications === "number" ? ` · ${data.applications} applied` : ""}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-muted">
            <Lock size={12} aria-hidden /> {state === "pending" ? "Opens after RMG approval" : "Closed"}
          </span>
        )}
      </div>

      {state === "pending" ? (
        <div className="mt-4 rounded-card border border-dashed border-subtle bg-surface-2 px-4 py-3 text-sm text-muted">
          The link is generated as soon as RMG approves this position for sourcing — it will appear here for TA to post.
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              readOnly
              value={data.apply_url}
              aria-label="Application link"
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-control border border-subtle bg-surface-2 px-3 py-2 font-mono text-xs text-primary"
            />
            <button type="button" className={btnPrimary} onClick={() => void doCopy("link")}>
              {copied === "link" ? <Check size={15} aria-hidden /> : <ClipboardCopy size={15} aria-hidden />}
              {copied === "link" ? "Copied" : "Copy link"}
            </button>
          </div>
          {data.base_reach === "private" && (
            <div role="alert" className="mt-3 flex items-start gap-2 rounded-card border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                <b>This link uses an office-network address ({data.base_url})</b> — it opens only inside your network,
                not for candidates on Naukri or LinkedIn. Don&apos;t post it yet. Once the application is live on its
                public address, set <b>Settings ▸ Company ▸ Organisation ▸ Email &amp; links ▸ Public base URL</b>
                {" "}(e.g. https://karnexgroup.com) — every link here changes to it automatically.
                {canSetBase && <>{" "}<CrmLink to="settings?tab=organisation" className="font-semibold underline">Open Settings</CrmLink></>}
              </span>
            </div>
          )}
          {state === "closed" && (
            <p className="mt-2 text-xs text-muted">
              This position isn&apos;t sourcing right now ({data.requirement_status.replace(/_/g, " ")}) — the form
              tells candidates applications are closed. It reopens automatically when sourcing resumes.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <a className={btnSecondary} href={data.apply_url} target="_blank" rel="noreferrer">
              <ExternalLink size={15} aria-hidden /> Open form
            </a>
            {state === "open" && (
              <>
                <button type="button" className={btnSecondary} onClick={() => void doCopy("post")}>
                  {copied === "post" ? <Check size={15} aria-hidden /> : <Megaphone size={15} aria-hidden />}
                  {copied === "post" ? "Copied" : "Copy job post"}
                </button>
                <a className={btnSecondary} href={share.linkedin} target="_blank" rel="noreferrer">
                  <Share2 size={15} aria-hidden /> Share on LinkedIn
                </a>
                <a className={btnSecondary} href={share.whatsapp} target="_blank" rel="noreferrer">
                  <Share2 size={15} aria-hidden /> WhatsApp
                </a>
              </>
            )}
          </div>
          {state === "open" && (
            <p className="mt-3 text-xs text-muted">
              Naukri: paste the copied job post (it ends with this link) into the job description or the
              &ldquo;apply link&rdquo; field. The form asks for name, email, phone, experience, skills, notice
              period, CTC, locations and the resume.
            </p>
          )}
        </>
      )}
    </div>
  );
}
