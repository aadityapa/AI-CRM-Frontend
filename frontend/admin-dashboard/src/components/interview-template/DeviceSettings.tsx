/**
 * Which devices a candidate may use — set on the interview template
 * (25 Nov 2026). Stored as `weights.devices = { allowPhone }` and read by the
 * server's `services/interview/device_policy.py` (keep the key in step).
 *
 * Off (the default): laptop / PC only, exactly as before. On: the invite link
 * also opens on a phone or tablet, the candidate page switches to its phone
 * layout, and the phone anti-cheating rules apply (the screen cannot be
 * recorded on a phone, so the camera, microphone and app-switch checks carry
 * the weight).
 */
import { AlertTriangle, Laptop, ShieldCheck, Smartphone } from "lucide-react";

export type DevicesConfig = { allowPhone: boolean };

export const DEVICES_DEFAULT: DevicesConfig = { allowPhone: false };

function flag(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  return ["true", "1", "yes", "on"].includes(String(v ?? "").trim().toLowerCase());
}

/** PURE: read the saved setting (missing = laptop / PC only). */
export function devicesFromWeights(weights: unknown): DevicesConfig {
  const raw = weights && typeof weights === "object" ? (weights as Record<string, unknown>).devices : null;
  const c = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { allowPhone: flag(c.allowPhone ?? c.allow_phone) };
}

/** PURE: the object saved under `weights.devices`. */
export function devicesToWeights(c: DevicesConfig): Record<string, unknown> {
  return { allowPhone: !!c.allowPhone };
}

/** What the page does on a phone instead of full screen + screen recording. */
export const PHONE_CONTROLS: { title: string; body: string }[] = [
  { title: "Front camera always on", body: "Face, extra faces and look-away are watched like on a laptop; the camera and microphone are recorded." },
  { title: "Leaving the app is a warning", body: "Another app, the home screen, a call, the notification panel or locking the screen — 3 warnings, then the next ends it." },
  { title: "Split screen / floating windows", body: "A chat bubble, picture-in-picture or split screen over the interview counts as a warning." },
  { title: "Held upright", body: "Turning the phone sideways covers the question until it is upright again (allowed during a coding question)." },
  { title: "Camera cut off", body: "A call or another app taking the camera is flagged for the reviewer; the screen is kept awake." },
];

export function DeviceSettings({
  value,
  onChange,
  typedQuestions = 0,
}: {
  value: DevicesConfig;
  onChange: (v: DevicesConfig) => void;
  /** Pseudo-code + coding questions in this template (typing them on a phone is harder). */
  typedQuestions?: number;
}) {
  const on = value.allowPhone;
  return (
    <section className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised" aria-labelledby="tplDevicesTitle">
      <div className="flex flex-wrap items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-control text-white bg-gradient-to-br ${on ? "from-emerald-500 to-teal-600" : "from-slate-500 to-slate-700"}`}>
          {on ? <Smartphone className="h-5 w-5" aria-hidden /> : <Laptop className="h-5 w-5" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="tplDevicesTitle" className="text-sm font-extrabold text-primary">Devices the candidate may use</h3>
          <p className="mt-0.5 text-xs text-muted">
            {on
              ? "Laptop / PC or a phone / tablet. On a phone the interview page switches to a phone layout by itself."
              : "Laptop / PC only (with a camera). A link opened on a phone asks the candidate to use a computer."}
          </p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold text-primary">
          <span>Allow a phone or tablet</span>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Allow a phone or tablet for this interview"
            onClick={() => onChange({ allowPhone: !on })}
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
        </label>
      </div>

      {on ? (
        <div className="mt-3 space-y-3">
          <div className="rounded-control border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/30">
            <p className="flex items-center gap-1.5 text-xs font-extrabold text-emerald-800 dark:text-emerald-300">
              <ShieldCheck className="h-4 w-4" aria-hidden /> How cheating is controlled on a phone
            </p>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {PHONE_CONTROLS.map((c) => (
                <li key={c.title} className="text-xs text-secondary">
                  <b className="text-primary">{c.title}.</b> {c.body}
                </li>
              ))}
            </ul>
          </div>
          <p className="flex items-start gap-1.5 rounded-control border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              A phone cannot share or record its screen, so the reviewer sees the camera only. The Integrity tab marks the
              interview <b>On a phone</b>.
              {typedQuestions > 0 && (
                <> This template has {typedQuestions} pseudo-code / coding question{typedQuestions === 1 ? "" : "s"} — typing code on a phone keyboard is slow, so allow enough minutes.</>
              )}
            </span>
          </p>
        </div>
      ) : null}
    </section>
  );
}
