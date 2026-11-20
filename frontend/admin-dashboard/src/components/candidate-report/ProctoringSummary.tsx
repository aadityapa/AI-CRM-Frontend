/**
 * Anti-cheating checks on the candidate report (13 Nov 2026).
 *
 * Reads `report.proctoring` (server `services/interview/proctoring.report_summary`)
 * and `report.live_intervention` (a recruiter who watched or ended the
 * interview). Renders nothing for an interview whose template turned no check
 * on and where no recruiter acted. Display only — never scored.
 */
import { Ban, CheckCircle2, Eye, Hand, Headphones, Lightbulb, ScanLine, ShieldCheck, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

export type PreCheck = { check: string; label: string; attempts: number; passed: boolean; last_reason?: string; detail?: string };

export type ProctoringReport = {
  settings?: Record<string, unknown>;
  pre_checks?: PreCheck[];
  gesture_prompts?: { asked: number; passed: number; missed: number };
  headphones_disconnected?: number;
  audio_device_changed?: number;
  low_light?: number;
  reading_pattern?: number;
  reading_questions?: string[];
  room_scan?: { started_at?: string; done_at?: string } | null;
  flags?: string[];
};

export type LiveIntervention = {
  watches?: number;
  calls?: number;
  terminated?: { reason: string; by: string; at: number } | null;
};

export function proctoringFromReport(report: Record<string, unknown> | null | undefined): ProctoringReport | null {
  const raw = report && typeof report === "object" ? (report as Record<string, unknown>).proctoring : null;
  return raw && typeof raw === "object" ? (raw as ProctoringReport) : null;
}

export function liveFromReport(report: Record<string, unknown> | null | undefined): LiveIntervention | null {
  const raw = report && typeof report === "object" ? (report as Record<string, unknown>).live_intervention : null;
  return raw && typeof raw === "object" ? (raw as LiveIntervention) : null;
}

/** PURE: the verdict line — "Clean" when nothing was flagged. */
export function proctoringVerdict(p: ProctoringReport | null, live: LiveIntervention | null): { tone: "ok" | "warn" | "bad"; text: string } {
  if (live?.terminated) return { tone: "bad", text: `Ended by the recruiter (${live.terminated.by}): ${live.terminated.reason}` };
  const flags = p?.flags || [];
  if (!flags.length) return { tone: "ok", text: "Every check passed — nothing flagged." };
  return { tone: "warn", text: `${flags.length} thing${flags.length > 1 ? "s" : ""} to check in the recording` };
}

const fmt = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
};

function Stat({ icon, label, value, bad }: { icon: ReactNode; label: string; value: ReactNode; bad?: boolean }) {
  return (
    <div className={`rounded-control border px-3 py-2 ${bad ? "border-warning/40 bg-warning-soft" : "border-subtle bg-surface-1"}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{icon} {label}</div>
      <div className={`mt-0.5 text-sm font-bold ${bad ? "text-warning" : "text-primary"}`}>{value}</div>
    </div>
  );
}

export function ProctoringSummary({ proctoring, live }: { proctoring: ProctoringReport | null; live: LiveIntervention | null }) {
  if (!proctoring && !live?.terminated && !live?.watches) return null;
  const v = proctoringVerdict(proctoring, live);
  const g = proctoring?.gesture_prompts;
  const tone = v.tone === "ok" ? "border-success/30 bg-success-soft text-success"
    : v.tone === "bad" ? "border-danger/30 bg-danger-soft text-danger" : "border-warning/40 bg-warning-soft text-warning";
  return (
    <section className="mt-4 rounded-card border border-subtle bg-surface-1 p-4" aria-label="Anti-cheating checks">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-control bg-gradient-to-br from-emerald-500 to-teal-600 text-[#fff]" aria-hidden>
            <ShieldCheck size={16} />
          </span>
          <div className="text-sm font-bold text-primary">Anti-cheating checks</div>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
          {v.tone === "ok" ? <CheckCircle2 size={13} /> : v.tone === "bad" ? <Ban size={13} /> : <TriangleAlert size={13} />}
          {v.text}
        </span>
      </div>

      {(proctoring?.pre_checks || []).length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">Before the interview</div>
          <div className="flex flex-wrap gap-2">
            {(proctoring?.pre_checks || []).map((c) => (
              <span key={c.check}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ring-subtle ${c.passed ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}
                    title={c.detail || c.last_reason || ""}>
                {c.passed ? <CheckCircle2 size={12} /> : <TriangleAlert size={12} />}
                {c.label}: {c.passed ? "passed" : "not passed"}{c.attempts > 1 ? ` · ${c.attempts} attempts` : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      {proctoring && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Stat icon={<Hand size={12} />} label="Gesture prompts"
                value={g && g.asked ? `${g.passed} of ${g.asked} shown` : "—"} bad={!!g?.missed} />
          <Stat icon={<Eye size={12} />} label="Reading pattern"
                value={proctoring.reading_pattern ? `${proctoring.reading_pattern}× (Q${(proctoring.reading_questions || []).join(", Q") || "?"})` : "None"}
                bad={!!proctoring.reading_pattern} />
          <Stat icon={<Headphones size={12} />} label="Headphones"
                value={proctoring.headphones_disconnected ? `Unplugged ${proctoring.headphones_disconnected}×` : proctoring.audio_device_changed ? `${proctoring.audio_device_changed} device change(s)` : "Stayed connected"}
                bad={!!proctoring.headphones_disconnected} />
          <Stat icon={<Lightbulb size={12} />} label="Lighting"
                value={proctoring.low_light ? `Poor ${proctoring.low_light}×` : "Good"} bad={!!proctoring.low_light} />
          <Stat icon={<ScanLine size={12} />} label="Room scan"
                value={proctoring.room_scan?.started_at ? `${fmt(proctoring.room_scan.started_at)} – ${fmt(proctoring.room_scan.done_at)}` : "Not asked"} />
        </div>
      )}

      {(proctoring?.flags || []).length > 0 && (
        <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-secondary">
          {(proctoring?.flags || []).map((f) => <li key={f}>{f}</li>)}
        </ul>
      )}
      {live && (live.watches || live.terminated) ? (
        <p className="mt-3 text-xs text-muted">
          {live.watches ? `A recruiter watched live ${live.watches} time${live.watches > 1 ? "s" : ""} (the candidate was told). ` : ""}
          {live.terminated ? `Ended by ${live.terminated.by}: ${live.terminated.reason}` : ""}
        </p>
      ) : null}
      <p className="mt-2 text-[11px] text-muted">Display only — never part of the score. Seek the recording to the times on the Integrity timeline.</p>
    </section>
  );
}
