/**
 * The action-dialog kit (30 Sep 2026, user ask: "redesign the Schedule, Edit
 * applicant, Hold / Reject / Self Withdraw pop-ups — best of best, the same
 * design for every role").
 *
 * ONE vocabulary every small workflow dialog is built from:
 *
 *   DialogHero     the gradient header (it replaces the Modal title bar via
 *                  `Modal hero=`): icon tile · eyebrow · title · the person ·
 *                  "where this sends them" strip
 *   DialogSection  a numbered step card whose number turns into a tick
 *   QuickPicks     one-tap chips (reasons, times …)
 *   ReasonBox      the note / reason field with its counter and picks
 *   WhatHappens    the consequences, said before the click
 *   DialogActions  Cancel + the tone-coloured confirm (+ Ctrl/⌘+Enter)
 *   DecisionDialog the whole "decide + reason" dialog in one component —
 *                  Hold, Reject, Self Withdraw, Technical Screening, the
 *                  interview route and the RMG screening all use it
 *
 * Tones are Tailwind palette colours, never `var()` tokens with an alpha
 * modifier (those compile to nothing — see F-V2 CLAUDE.md, 21 Sep 2026).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, CheckCircle2, Loader2, type LucideIcon } from "lucide-react";

import { Modal, btnSecondary, focusRing, inputCls } from "./ui";

export type DialogTone =
  | "brand" | "indigo" | "emerald" | "amber" | "rose" | "fuchsia" | "purple" | "sky" | "slate";

type ToneSpec = { grad: string; soft: string; text: string; ring: string; dot: string };

export const DIALOG_TONES: Record<DialogTone, ToneSpec> = {
  brand: { grad: "from-blue-600 via-indigo-600 to-indigo-700", soft: "bg-blue-50 dark:bg-blue-950/40", text: "text-blue-700 dark:text-blue-300", ring: "ring-blue-500", dot: "bg-blue-600" },
  indigo: { grad: "from-indigo-600 via-indigo-600 to-purple-700", soft: "bg-indigo-50 dark:bg-indigo-950/40", text: "text-indigo-700 dark:text-indigo-300", ring: "ring-indigo-500", dot: "bg-indigo-600" },
  emerald: { grad: "from-emerald-500 via-emerald-600 to-teal-700", soft: "bg-emerald-50 dark:bg-emerald-950/40", text: "text-emerald-700 dark:text-emerald-300", ring: "ring-emerald-500", dot: "bg-emerald-600" },
  amber: { grad: "from-amber-500 via-orange-500 to-orange-600", soft: "bg-amber-50 dark:bg-amber-950/40", text: "text-amber-800 dark:text-amber-300", ring: "ring-amber-500", dot: "bg-amber-500" },
  rose: { grad: "from-rose-500 via-rose-600 to-pink-700", soft: "bg-rose-50 dark:bg-rose-950/40", text: "text-rose-700 dark:text-rose-300", ring: "ring-rose-500", dot: "bg-rose-600" },
  fuchsia: { grad: "from-fuchsia-500 via-fuchsia-600 to-purple-700", soft: "bg-fuchsia-50 dark:bg-fuchsia-950/40", text: "text-fuchsia-700 dark:text-fuchsia-300", ring: "ring-fuchsia-500", dot: "bg-fuchsia-600" },
  purple: { grad: "from-purple-500 via-purple-600 to-indigo-700", soft: "bg-purple-50 dark:bg-purple-950/40", text: "text-purple-700 dark:text-purple-300", ring: "ring-purple-500", dot: "bg-purple-600" },
  sky: { grad: "from-sky-500 via-sky-600 to-blue-700", soft: "bg-sky-50 dark:bg-sky-950/40", text: "text-sky-700 dark:text-sky-300", ring: "ring-sky-500", dot: "bg-sky-600" },
  slate: { grad: "from-slate-600 via-slate-700 to-slate-800", soft: "bg-slate-100 dark:bg-slate-900/60", text: "text-slate-700 dark:text-slate-300", ring: "ring-slate-500", dot: "bg-slate-600" },
};

export const initials = (name?: string | null) =>
  String(name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";

/* ---------------------------------------------------------------- hero */

export function DialogHero({ tone, icon: Icon, eyebrow, title, subtitle, person, flow, chips }: {
  tone: DialogTone;
  icon: LucideIcon;
  eyebrow: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** The candidate / record the action is about. */
  person?: { name: string; meta?: ReactNode } | null;
  /** Where this sends them — steps before `current` read as done. */
  flow?: { steps: string[]; current: number } | null;
  chips?: ReactNode;
}) {
  const t = DIALOG_TONES[tone];
  return (
    <div className={`relative overflow-hidden bg-gradient-to-br text-white ${t.grad}`}>
      <span aria-hidden className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full bg-white/10" />
      <span aria-hidden className="pointer-events-none absolute -bottom-20 right-24 h-40 w-40 rounded-full bg-white/5" />
      <div className="relative flex items-start gap-3.5 px-5 pb-4 pt-5 pr-12">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15 shadow-lg ring-1 ring-white/30">
          <Icon className="h-6 w-6" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/75">{eyebrow}</p>
          <h2 className="mt-0.5 text-lg font-bold leading-snug">{title}</h2>
          {subtitle && <p className="mt-0.5 hidden text-xs leading-relaxed text-white/85 sm:block">{subtitle}</p>}
          {(person || chips) && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {person && (
                <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-white/15 py-1 pl-1 pr-3 ring-1 ring-white/20">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#fff] text-[10px] font-bold text-[#1e293b]">
                    {initials(person.name)}
                  </span>
                  <span className="truncate text-xs font-semibold">{person.name}</span>
                  {person.meta && <span className="hidden truncate text-[11px] text-white/75 sm:inline">· {person.meta}</span>}
                </span>
              )}
              {chips}
            </div>
          )}
        </div>
      </div>
      {flow && flow.steps.length > 0 && (
        <ol className="relative flex flex-wrap items-center gap-x-1.5 gap-y-1 bg-black/15 px-5 py-2 text-[11px] font-semibold"
          aria-label="Where this sends them">
          {flow.steps.map((st, i) => (
            <li key={`${st}-${i}`} className="inline-flex items-center gap-1.5">
              {i > 0 && <ArrowRight className="h-3 w-3 text-white/50" aria-hidden />}
              {i < flow.current
                ? <span className="inline-flex items-center gap-1 text-white/80"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {st}</span>
                : i === flow.current
                  ? <span className="rounded-full bg-[#fff] px-2 py-0.5 text-[#312e81]">{st}</span>
                  : <span className="text-white/60">{st}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ sections */

export function DialogSection({ n, title, hint, done, optional, tone = "brand", action, children }: {
  n: number;
  title: string;
  hint?: ReactNode;
  done?: boolean;
  optional?: boolean;
  tone?: DialogTone;
  action?: ReactNode;
  children: ReactNode;
}) {
  const t = DIALOG_TONES[tone];
  return (
    <section className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
      <header className="mb-3 flex items-start gap-3">
        <span
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white transition-colors duration-micro ${
            done ? "bg-emerald-600" : `bg-gradient-to-br ${t.grad}`}`}
          aria-hidden
        >
          {done ? <CheckCircle2 className="h-4 w-4" /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-bold text-primary">
            {title}
            {optional && <span className="rounded-full bg-surface-2 px-2 py-px text-[10px] font-semibold text-muted">Optional</span>}
          </h3>
          {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function QuickPicks({ options, onPick, label, active, tone = "brand" }: {
  options: string[];
  onPick: (v: string) => void;
  label: string;
  /** The option that is currently in force (highlighted). */
  active?: string | null;
  tone?: DialogTone;
}) {
  const t = DIALOG_TONES[tone];
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map((o) => {
        const on = active != null && active === o;
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(o)}
            className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors duration-micro ${focusRing} ${
              on ? `border-transparent bg-gradient-to-r text-white ${t.grad}`
                : "border-subtle bg-surface-2 text-secondary hover:border-strong hover:text-primary"}`}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

/** A note / reason. `picks` append a ready phrase (a reason reads better whole). */
export function ReasonBox({ id, label, value, onChange, required, min = 0, max = 1000, placeholder, picks, error, tone = "brand", rows = 3, disabled }: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  min?: number;
  max?: number;
  placeholder?: string;
  picks?: string[];
  error?: string;
  tone?: DialogTone;
  rows?: number;
  /** Read-only rendering (the picks are hidden too). */
  disabled?: boolean;
}) {
  const len = value.trim().length;
  const short = required && len < min;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-semibold text-secondary">
          {label}{required && <span className="ml-0.5 text-danger">*</span>}
        </label>
        <span className={`text-[11px] tabular-nums ${short && len > 0 ? "text-warning" : "text-muted"}`}>
          {required && min > 0 && len < min ? `${min - len} more character${min - len === 1 ? "" : "s"}` : `${value.length}/${max}`}
        </span>
      </div>
      {picks && picks.length > 0 && !disabled && (
        <div className="mb-2">
          <QuickPicks label={`${label} — quick picks`} options={picks} tone={tone}
            onPick={(p) => onChange(value.trim() ? `${value.trim().replace(/[.;,]?$/, ";")} ${p}` : p)} />
        </div>
      )}
      <textarea
        id={id}
        rows={rows}
        maxLength={max}
        disabled={disabled}
        className={`${inputCls} resize-y${error ? " input-error" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={!!error}
      />
      {error && <p className="mt-1 text-xs font-semibold text-danger" role="alert">{error}</p>}
    </div>
  );
}

export function WhatHappens({ title = "What happens next", items, tone = "brand" }: {
  title?: string;
  items: { icon: LucideIcon; text: ReactNode }[];
  tone?: DialogTone;
}) {
  const t = DIALOG_TONES[tone];
  if (!items.length) return null;
  return (
    <div className={`rounded-card p-3.5 ${t.soft}`}>
      <p className={`mb-2 text-[11px] font-bold uppercase tracking-wide ${t.text}`}>{title}</p>
      <ul className="space-y-1.5">
        {items.map(({ icon: Icon, text }, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-secondary">
            <Icon className={`mt-px h-3.5 w-3.5 shrink-0 ${t.text}`} aria-hidden />
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Ctrl/⌘+Enter runs `fn` — read through a ref so the listener is attached once. */
export function useCtrlEnter(fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); ref.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function DialogActions({ onCancel, busy, tone, icon: Icon, label, busyLabel = "Saving…", disabled, onConfirm, hint }: {
  onCancel: () => void;
  busy?: boolean;
  tone: DialogTone;
  icon?: LucideIcon;
  label: string;
  busyLabel?: string;
  disabled?: boolean;
  onConfirm: () => void;
  /** Left-hand line — what is still missing, or a keyboard hint. */
  hint?: ReactNode;
}) {
  const t = DIALOG_TONES[tone];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className={`text-xs text-muted sm:min-w-0 sm:flex-1 ${hint ? "w-full sm:w-auto" : "hidden sm:block"}`}>
        {hint ?? "Ctrl + Enter to confirm"}
      </div>
      <button type="button" className={`${btnSecondary} ml-auto sm:ml-0`} onClick={onCancel} disabled={busy}>Cancel</button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={busy || disabled}
        className={`inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r px-4 text-sm font-semibold text-white shadow-md transition-all duration-micro hover:shadow-lg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100 ${focusRing} ${t.grad}`}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
        {busy ? busyLabel : label}
      </button>
    </div>
  );
}

/** The server's refusal, said inside the dialog (the button re-enables). */
export function DialogFailure({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-card border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300" role="alert">
      {message}
    </p>
  );
}

/* --------------------------------------------------------- the decision */

export type DecisionSpec = {
  tone: DialogTone;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  /** One or two sentences: what this decision does. */
  intro: ReactNode;
  flow?: { steps: string[]; current: number } | null;
  reason: {
    label: string;
    required?: boolean;
    min?: number;
    placeholder?: string;
    picks?: string[];
  };
  happens: { icon: LucideIcon; text: ReactNode }[];
  confirmLabel: string;
  busyLabel?: string;
};

/**
 * "Decide, say why, confirm" — one dialog for every such action. The caller
 * supplies the words (`spec`) and `onConfirm(note)`, which posts and throws on
 * failure (the message is shown in the dialog and the button re-enables).
 */
export function DecisionDialog({ spec, person, notice, onConfirm, onClose, children, initialNote = "" }: {
  spec: DecisionSpec;
  person?: { name: string; meta?: ReactNode } | null;
  /** Context the decision should be taken with (over budget, blocked …). */
  notice?: ReactNode;
  onConfirm: (note: string) => Promise<void>;
  onClose: () => void;
  /** Extra content between the intro and the reason. */
  children?: ReactNode;
  initialNote?: string;
}) {
  const [note, setNote] = useState(initialNote);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [failure, setFailure] = useState("");
  const min = spec.reason.required ? spec.reason.min ?? 5 : 0;
  const tooShort = note.trim().length < min;

  const confirm = async () => {
    if (busy) return;
    if (tooShort) { setErr(`Give a reason of at least ${min} characters`); return; }
    setBusy(true);
    setFailure("");
    try {
      await onConfirm(note.trim());
    } catch (e: any) {
      setFailure(e?.message || "Could not save — try again");
      setBusy(false);
    }
  };
  useCtrlEnter(() => void confirm());

  return (
    <Modal
      title={`${spec.title}${person ? ` — ${person.name}` : ""}`}
      medium
      onClose={() => { if (!busy) onClose(); }}
      dirty={note.trim() !== initialNote.trim()}
      hero={<DialogHero tone={spec.tone} icon={spec.icon} eyebrow={spec.eyebrow} title={spec.title}
        person={person} flow={spec.flow} />}
      footer={
        <DialogActions tone={spec.tone} icon={spec.icon} label={spec.confirmLabel} busyLabel={spec.busyLabel}
          busy={busy} onCancel={onClose} onConfirm={() => void confirm()}
          hint={tooShort && spec.reason.required
            ? <span className="text-warning">A reason is needed before you confirm</span>
            : undefined} />
      }
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-secondary">{spec.intro}</p>
        {notice}
        {children}
        <ReasonBox id="decision-note" label={spec.reason.label} value={note}
          onChange={(v) => { setNote(v); if (err) setErr(""); }} required={spec.reason.required} min={min}
          placeholder={spec.reason.placeholder} picks={spec.reason.picks} tone={spec.tone} error={err} />
        <WhatHappens items={spec.happens} tone={spec.tone} />
        <DialogFailure message={failure} />
      </div>
    </Modal>
  );
}
