/**
 * The slots the customer offered, passed by Sales to TA (29 Sep 2026). ONE home
 * for both views of an offer (B-V2 `candidate_profiles.latest_customer_slots`):
 *
 *  - `SalesSlotsButton` — the "Sales slots (N)" button on a row / task item that
 *    opens a small pop-up listing every slot with its link, the panel, the
 *    length and Sales' note, and (optionally) a Schedule button;
 *  - `CustomerSlotPicker` — the one-click picks inside TA's Schedule form.
 */
import { useState } from "react";
import { CalendarClock, CalendarPlus, Check, ExternalLink } from "lucide-react";
import { Modal } from "./ui";
import { FLOW_BTN } from "./flowButtons";
import { fmtDateTime12 } from "../../lib/datetime";
import { ROUND_KIND_LABEL, type CustomerSlotOffer } from "../lib/interviewRounds";

/** The offer, when it is for THIS round (an L1 offer never stands for the L2). */
export function offerFor(offer: CustomerSlotOffer | null | undefined, kind: string): CustomerSlotOffer | null {
  return offer && offer.kind === kind && offer.slots.length ? offer : null;
}

function OfferMeta({ offer }: { offer: CustomerSlotOffer }) {
  const bits = [
    offer.interviewer && `Panel: ${offer.interviewer}`,
    offer.duration_minutes && `${offer.duration_minutes} min`,
  ].filter(Boolean);
  return (
    <>
      {bits.length > 0 && <p className="text-xs text-secondary">{bits.join(" · ")}</p>}
      {offer.note && <p className="text-xs text-secondary">Sales' note: <i>{offer.note}</i></p>}
    </>
  );
}

/** "Sales slots (N)" → a small pop-up with every slot the customer offered. */
export function SalesSlotsButton({ offer, kind, onSchedule, scheduleLabel }: {
  offer: CustomerSlotOffer | null | undefined;
  kind: string;
  /** Opens the Schedule form (TA). Omitted = read-only pop-up. */
  onSchedule?: () => void;
  scheduleLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const mine = offerFor(offer, kind);
  if (!mine) return null;
  const round = (ROUND_KIND_LABEL[kind] || kind).replace(" Interview", "");
  return (
    <>
      <button type="button" className={`${FLOW_BTN.view} !py-1`} onClick={() => setOpen(true)}
        title="The slots the customer offered — Sales sent them with Customer Interviewing">
        <CalendarClock size={13} /> Sales slots ({mine.slots.length})
      </button>
      {open && (
        <Modal title={`${round} — slots offered by the customer`} onClose={() => setOpen(false)}>
          <div className="space-y-3">
            <p className="text-sm text-secondary">
              Ask the candidate which slot suits, then schedule it — the candidate is emailed the meeting link
              and a calendar invite.
              {mine.proposed_at && <span className="text-muted"> Sent by Sales {fmtDateTime12(mine.proposed_at)}.</span>}
            </p>
            <ol className="divide-y divide-subtle rounded-card border border-subtle">
              {mine.slots.map((s, i) => (
                <li key={`${s.label}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="font-semibold text-primary">
                    <span className="mr-2 text-muted">{i + 1}.</span>{s.label}
                  </span>
                  {s.meeting_link ? (
                    <a href={s.meeting_link} target="_blank" rel="noreferrer noopener"
                      className="inline-flex max-w-full items-center gap-1 truncate text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
                      <ExternalLink size={12} /> Meeting link
                    </a>
                  ) : (
                    <span className="text-xs text-warning">No link yet — TA adds it when scheduling</span>
                  )}
                </li>
              ))}
            </ol>
            <OfferMeta offer={mine} />
            {onSchedule && (
              <div className="flex justify-end">
                <button type="button" className={FLOW_BTN.primary}
                  onClick={() => { setOpen(false); onSchedule(); }}>
                  <CalendarPlus size={13} /> {scheduleLabel || `Schedule ${round}`}
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-30T10:00" (the IST wall clock the server hands back) → the parts a
 *  slot card prints. PURE — no Date zone conversion, so the card shows exactly
 *  the clock Sales typed. null for a slot whose time never parsed. */
export function slotParts(value: string | null | undefined):
  { weekday: string; day: string; month: string; time: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || "");
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  const h = Number(hh);
  const weekday = WEEKDAYS[new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))).getUTCDay()];
  return {
    weekday, day: String(Number(d)), month: MONTHS[Number(mo) - 1] || "",
    time: `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? "AM" : "PM"}`,
  };
}

/** One-click picks inside TA's Schedule form — a card per slot (29 Sep 2026
 *  redesign): the day as a calendar tile, the time large, whether the customer
 *  sent a link. Picking fills the date, link, panel and length (the form does
 *  the filling — see `onPick`). */
export function CustomerSlotPicker({ offer, picked, onPick }: {
  offer: CustomerSlotOffer; picked: number | null; onPick: (i: number) => void;
}) {
  const chips = [
    offer.interviewer && `Panel: ${offer.interviewer}`,
    offer.duration_minutes && `${offer.duration_minutes} min`,
  ].filter(Boolean) as string[];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-secondary">
          The customer offered {offer.slots.length === 1 ? "this slot" : `${offer.slots.length} slots`} — pick the one
          the candidate confirmed
        </span>
        {offer.proposed_at && (
          <span className="text-[11px] text-muted">from Sales · {fmtDateTime12(offer.proposed_at)}</span>
        )}
      </div>
      <div role="radiogroup" aria-label="Slots offered by the customer"
        className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {offer.slots.map((s, i) => {
          const on = picked === i;
          const parts = slotParts(s.scheduled_at);
          return (
            <button key={`${s.label}-${i}`} type="button" role="radio" aria-checked={on}
              onClick={() => onPick(i)}
              title={parts ? undefined : "Not a date the form can read — type the time below"}
              className={`group relative flex items-center gap-3 rounded-card border p-2.5 text-left transition-all duration-micro ${
                on ? "border-sky-500 bg-sky-50 ring-2 ring-sky-500 dark:bg-sky-950/40"
                   : "border-subtle bg-surface-1 hover:border-sky-300 hover:bg-surface-2"}`}>
              <span className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl border text-center leading-none ${
                on ? "border-sky-600 bg-sky-600 text-white" : "border-subtle bg-surface-2 text-primary"}`}>
                <span className={`text-[10px] font-bold uppercase ${on ? "text-white" : "text-muted"}`}>
                  {parts ? parts.weekday : "Slot"}
                </span>
                <span className="text-lg font-extrabold">{parts ? parts.day : i + 1}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-primary">
                  {parts ? `${parts.time}` : s.label}
                  {parts && <span className="ml-1 text-xs font-medium text-muted">{parts.month} · IST</span>}
                </span>
                <span className={`mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold ${
                  s.meeting_link ? "text-success" : "text-warning"}`}>
                  {s.meeting_link ? <><ExternalLink size={11} /> Customer link included</> : "No link — add it below"}
                </span>
              </span>
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                on ? "border-sky-600 bg-sky-600 text-white" : "border-strong bg-surface-1 text-transparent"}`} aria-hidden>
                <Check size={12} />
              </span>
            </button>
          );
        })}
      </div>
      {(chips.length > 0 || offer.note) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <span key={c} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-secondary">{c}</span>
          ))}
          {offer.note && <span className="text-xs text-secondary">Sales' note: <i>{offer.note}</i></span>}
        </div>
      )}
    </div>
  );
}
