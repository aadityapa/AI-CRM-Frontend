/**
 * Anti-cheating checks on an interview template (13 Nov 2026).
 *
 * Stored in the template's `weights.proctoring` bag and read by the server's
 * `services/interview/proctoring.proctoring_settings` — keep the key names in
 * step. Everything is OFF by default, so an existing template interviews
 * exactly as before until RMG / GM turns a check on here.
 *
 * Failure rules (user decision): before the interview a check set to
 * "Required" blocks the start until it passes, "Recommended" lets the
 * candidate continue and records the miss; during the interview nothing ends
 * the interview — misses are flagged for the reviewer.
 */
import { Camera, Eye, Hand, Headphones, Lightbulb, ScanEye, ScanLine, ShieldCheck, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

export type CheckMode = "off" | "warn" | "require";

export type ProctoringConfig = {
  headphones: CheckMode;
  lighting: CheckMode;
  gestureCheck: boolean;
  gesturePrompts: number;
  gazeCalibration: boolean;
  readingDetection: boolean;
  roomScan: boolean;
};

export const MAX_GESTURE_PROMPTS = 5;

export const PROCTORING_OFF: ProctoringConfig = {
  headphones: "off",
  lighting: "off",
  gestureCheck: false,
  gesturePrompts: 0,
  gazeCalibration: false,
  readingDetection: false,
  roomScan: false,
};

/** Our recommendation: the strict set, room scan left to the template author. */
export const PROCTORING_RECOMMENDED: ProctoringConfig = {
  headphones: "require",
  lighting: "require",
  gestureCheck: true,
  gesturePrompts: 2,
  gazeCalibration: true,
  readingDetection: true,
  roomScan: false,
};

const MODES: CheckMode[] = ["off", "warn", "require"];

function mode(v: unknown): CheckMode {
  const t = String(v ?? "").trim().toLowerCase();
  if (MODES.includes(t as CheckMode)) return t as CheckMode;
  return ["true", "1", "yes", "on"].includes(t) ? "require" : "off";
}

function flag(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  return ["true", "1", "yes", "on"].includes(String(v ?? "").trim().toLowerCase());
}

/** PURE: read the saved settings (missing = all off). */
export function proctoringFromWeights(weights: unknown): ProctoringConfig {
  const raw = weights && typeof weights === "object" ? (weights as Record<string, unknown>).proctoring : null;
  const c = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const n = Math.round(Number(c.gesturePrompts ?? c.gesture_prompts ?? 0));
  return {
    headphones: mode(c.headphones),
    lighting: mode(c.lighting),
    gestureCheck: flag(c.gestureCheck ?? c.gesture_check),
    gesturePrompts: Number.isFinite(n) ? Math.max(0, Math.min(MAX_GESTURE_PROMPTS, n)) : 0,
    gazeCalibration: flag(c.gazeCalibration ?? c.gaze_calibration),
    readingDetection: flag(c.readingDetection ?? c.reading_detection),
    roomScan: flag(c.roomScan ?? c.room_scan),
  };
}

/** PURE: the object saved under `weights.proctoring`. */
export function proctoringToWeights(c: ProctoringConfig): Record<string, unknown> {
  return {
    headphones: c.headphones,
    lighting: c.lighting,
    gestureCheck: c.gestureCheck,
    gesturePrompts: Math.max(0, Math.min(MAX_GESTURE_PROMPTS, Math.round(c.gesturePrompts))),
    gazeCalibration: c.gazeCalibration,
    readingDetection: c.readingDetection,
    roomScan: c.roomScan,
  };
}

/** PURE: how many checks are on (the header line). */
export function proctoringCount(c: ProctoringConfig): number {
  return [c.headphones !== "off", c.lighting !== "off", c.gestureCheck, c.gesturePrompts > 0, c.gazeCalibration,
    c.readingDetection, c.roomScan].filter(Boolean).length;
}

/** PURE: the extra minutes the candidate spends before the first question. */
export function proctoringSetupMinutes(c: ProctoringConfig): number {
  const secs = (c.headphones !== "off" ? 30 : 0) + (c.lighting !== "off" ? 15 : 0) + (c.gestureCheck ? 30 : 0)
    + (c.gazeCalibration ? 15 : 0) + (c.roomScan ? 30 : 0);
  return Math.round((secs / 60) * 10) / 10;
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-micro ${
        on ? "bg-emerald-600" : "bg-slate-300 dark:bg-slate-600"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-[#fff] shadow transition-transform duration-micro ${
          on ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

const MODE_WORDS: Record<CheckMode, string> = { off: "Off", warn: "Recommended", require: "Required" };

function ModePicker({ value, onChange, label }: { value: CheckMode; onChange: (m: CheckMode) => void; label: string }) {
  return (
    <div className="inline-flex rounded-control bg-surface-2 p-0.5 ring-1 ring-inset ring-subtle" role="radiogroup" aria-label={label}>
      {MODES.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={value === m}
          onClick={() => onChange(m)}
          className={`rounded-control px-2.5 py-1 text-[11px] font-bold transition-colors duration-micro ${
            value === m
              ? m === "require"
                ? "bg-emerald-600 text-[#fff] shadow-raised"
                : m === "warn"
                  ? "bg-amber-500 text-[#fff] shadow-raised"
                  : "bg-surface-0 text-primary shadow-raised"
              : "text-secondary hover:text-primary"
          }`}
        >
          {MODE_WORDS[m]}
        </button>
      ))}
    </div>
  );
}

function Row({
  icon,
  tone,
  title,
  hint,
  on,
  control,
  children,
}: {
  icon: ReactNode;
  tone: string;
  title: string;
  hint: string;
  on: boolean;
  control: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={`rounded-card border p-3 transition-colors ${on ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40" : "border-subtle bg-surface-1"}`}>
      <div className="flex items-start gap-3">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-control bg-gradient-to-br text-[#fff] ${tone}`} aria-hidden>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-bold text-primary">{title}</div>
            {control}
          </div>
          <p className="mt-0.5 text-xs leading-snug text-muted">{hint}</p>
          {on && children ? <div className="mt-2">{children}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function ProctoringSettings({
  value,
  onChange,
}: {
  value: ProctoringConfig;
  onChange: (next: ProctoringConfig) => void;
}) {
  const set = (patch: Partial<ProctoringConfig>) => onChange({ ...value, ...patch });
  const count = proctoringCount(value);
  const setup = proctoringSetupMinutes(value);
  return (
    <div className="fx-gradient-border rounded-card border border-subtle bg-surface-1 p-4 md:col-span-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-card bg-gradient-to-br from-emerald-500 to-teal-600 text-[#fff]" aria-hidden>
            <ShieldCheck size={20} />
          </span>
          <div>
            <div className="text-xs font-extrabold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
              Anti-cheating checks
            </div>
            <div className="mt-0.5 text-sm font-semibold text-secondary">
              {count
                ? `${count} check${count === 1 ? "" : "s"} on${setup ? ` · adds about ${setup} min before the first question` : ""}`
                : "OFF — camera, screen recording and the look-away rule only"}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onChange(PROCTORING_RECOMMENDED)}
            className="inline-flex h-9 items-center gap-1.5 rounded-control bg-gradient-to-r from-emerald-600 to-teal-600 px-3 text-xs font-bold text-[#fff] shadow-raised"
          >
            <Sparkles size={14} aria-hidden /> Use recommended
          </button>
          {count ? (
            <button
              type="button"
              onClick={() => onChange(PROCTORING_OFF)}
              className="h-9 rounded-control border border-subtle bg-surface-2 px-3 text-xs font-bold text-secondary hover:border-strong"
            >
              Turn all off
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-3 rounded-control bg-surface-2 px-3 py-2 text-xs leading-snug text-muted">
        <b className="text-secondary">Required</b> blocks the start until the check passes.{" "}
        <b className="text-secondary">Recommended</b> lets the candidate continue and records the miss. During the
        interview nothing ends it — misses are flagged on the Integrity tab and in the report.
      </div>

      <div className="mt-3 text-[11px] font-extrabold uppercase tracking-widest text-muted">Before the interview</div>
      <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Row
          icon={<Headphones size={18} />}
          tone="from-sky-500 to-blue-600"
          title="Headphones connected"
          hint="We play 2–4 beeps and ask how many the candidate heard while the microphone listens. With speakers the microphone hears them — the candidate is asked to connect headphones (wired or Bluetooth). Unplugging them during the interview is logged and, when Required, holds the candidate until they reconnect."
          on={value.headphones !== "off"}
          control={<ModePicker value={value.headphones} onChange={(m) => set({ headphones: m })} label="Headphones" />}
        />
        <Row
          icon={<Lightbulb size={18} />}
          tone="from-amber-500 to-orange-600"
          title="Good lighting"
          hint="The face must be clearly lit — not dark, not against a bright window. If the light goes bad during the interview the candidate gets a reminder and it is logged."
          on={value.lighting !== "off"}
          control={<ModePicker value={value.lighting} onChange={(m) => set({ lighting: m })} label="Lighting" />}
        />
        <Row
          icon={<Hand size={18} />}
          tone="from-fuchsia-500 to-purple-600"
          title="Gesture check (live person)"
          hint="After the device check: both open palms, then a gesture we name at random (fingers, thumbs up). Proves a live person, not a played video. Always required when on."
          on={value.gestureCheck}
          control={<Switch on={value.gestureCheck} onChange={(v) => set({ gestureCheck: v })} label="Gesture check" />}
        />
        <Row
          icon={<ScanEye size={18} />}
          tone="from-indigo-500 to-blue-700"
          title="Eye calibration"
          hint="The candidate follows a dot to the centre and the four corners (about 10 s). The look-away rule then uses their own screen range — fewer false warnings."
          on={value.gazeCalibration}
          control={<Switch on={value.gazeCalibration} onChange={(v) => set({ gazeCalibration: v })} label="Eye calibration" />}
        />
      </div>

      <div className="mt-4 text-[11px] font-extrabold uppercase tracking-widest text-muted">During the interview</div>
      <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Row
          icon={<Hand size={18} />}
          tone="from-rose-500 to-pink-600"
          title="Random gesture prompts"
          hint="On a few spoken questions (never the first, never a pseudo-code / coding one) a small card asks for a gesture for 10 seconds while the candidate answers. A miss is flagged, never a strike."
          on={value.gesturePrompts > 0}
          control={<Switch on={value.gesturePrompts > 0} onChange={(v) => set({ gesturePrompts: v ? Math.max(1, value.gesturePrompts || 2) : 0 })} label="Random gesture prompts" />}
        >
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-secondary">
            <span>Prompts per interview</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={value.gesturePrompts === n}
                onClick={() => set({ gesturePrompts: n })}
                className={`h-7 w-7 rounded-full border text-[11px] font-bold ${
                  value.gesturePrompts === n
                    ? "border-rose-500 bg-rose-600 text-[#fff]"
                    : "border-subtle bg-surface-1 text-secondary hover:bg-surface-2"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </Row>
        <Row
          icon={<Eye size={18} />}
          tone="from-teal-500 to-emerald-600"
          title="Reading detection"
          hint="Eyes that move line by line — as if reading notes or another window — are flagged on that question for the reviewer to check in the recording. Never ends the interview."
          on={value.readingDetection}
          control={<Switch on={value.readingDetection} onChange={(v) => set({ readingDetection: v })} label="Reading detection" />}
        />
        <Row
          icon={<ScanLine size={18} />}
          tone="from-slate-500 to-slate-700"
          title="Room scan"
          hint="Before the first question the candidate turns the camera slowly around the room, then shows the desk — recorded, about 20 seconds, and the clock has not started. The report links straight to it."
          on={value.roomScan}
          control={<Switch on={value.roomScan} onChange={(v) => set({ roomScan: v })} label="Room scan" />}
        />
        <div className="rounded-card border border-dashed border-subtle bg-surface-1 p-3 text-xs leading-snug text-muted">
          <div className="mb-1 flex items-center gap-2 font-bold text-secondary">
            <Camera size={14} aria-hidden /> Always on
          </div>
          Camera and entire-screen recording, extra-face and look-away warnings, tab-switch strikes — and a recruiter
          can join, watch live or end the interview from the Integrity tab (the candidate is told when they watch).
        </div>
      </div>
    </div>
  );
}
