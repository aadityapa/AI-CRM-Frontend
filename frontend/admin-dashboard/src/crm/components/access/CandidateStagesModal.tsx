/**
 * Candidate stages per role (13 Oct 2026, user ask: "a role-wise filter —
 * Sales only needs the candidates from Sales Screening on; Admin manages it
 * from Access Control, for Candidate Profiles and inside every Opportunity").
 *
 * One dialog for built-in and custom roles: tick the stages the role sees
 * (in flow order, each in the colour of its chip), or take a preset. Saved
 * with `PUT /api/roles/stage-access` (B-V2 `services/stage_access.py`). The
 * server then leaves every other stage's candidates out of Candidate
 * Profiles, the opportunity's Applicants and Applied Candidates — list,
 * counts and export — and the stage chips follow `/api/me.candidate_stages`.
 */
import { useMemo, useState } from "react";
import { Check, Eye, EyeOff, Filter, Link2, RotateCcw, Save } from "lucide-react";

import { Modal } from "../ui";
import { crmPut } from "../../api";
import { DialogActions, DialogFailure, DialogHero, DialogSection, WhatHappens, useCtrlEnter } from "../dialogKit";
import { STAGE_TONE } from "../../lib/candidateStageBuckets";

export type StageAccess = {
  stages: string[];
  all: boolean;
  is_default: boolean;
  default: string[];
  configurable: boolean;
};
export type StageCatalogue = {
  stages: { key: string; label: string }[];
  presets: { key: string; label: string; stages: string[] }[];
};

/** "Sales Screening → Closed" / "Every stage" — the short name of a set. PURE. */
export function stageSummary(stages: string[], catalogue: StageCatalogue | null): string {
  const all = catalogue?.stages ?? [];
  if (!all.length) return `${stages.length} stages`;
  const shown = all.filter((s) => stages.includes(s.key));
  if (shown.length === all.length) return "Every stage";
  if (!shown.length) return "No stage";
  if (shown.length === 1) return shown[0].label;
  // A gap in the middle reads as "N of M", not a misleading range.
  const first = all.findIndex((s) => s.key === shown[0].key);
  const last = all.findIndex((s) => s.key === shown[shown.length - 1].key);
  const contiguous = last - first + 1 === shown.length;
  return contiguous ? `${shown[0].label} → ${shown[shown.length - 1].label}` : `${shown.length} of ${all.length} stages`;
}

/** The same set, ignoring order. PURE. */
export function sameStages(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((k) => s.has(k));
}

/** The small line on a role card. */
export function StageAccessLine({ access, catalogue, onEdit }: {
  access?: StageAccess | null;
  catalogue: StageCatalogue | null;
  onEdit?: () => void;
}) {
  if (!access) return null;
  const all = access.all || !access.configurable;
  return (
    <div className="mt-2 flex items-center gap-2 rounded-control bg-surface-2 px-2 py-1.5">
      <Filter size={13} className="flex-none text-muted" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Candidate stages</p>
        <p className="truncate text-xs font-semibold text-primary" title={stageSummary(access.stages, catalogue)}>
          {access.configurable ? stageSummary(access.stages, catalogue) : "Every stage (always)"}
          {access.configurable && access.is_default && <span className="ml-1 font-normal text-muted">· default</span>}
        </p>
      </div>
      {!all && <span className="flex-none rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
        {access.stages.length}/{catalogue?.stages.length ?? "—"}
      </span>}
      {access.configurable && onEdit && (
        <button type="button" onClick={onEdit}
          className="inline-flex flex-none items-center gap-1 rounded-control border border-strong px-2 py-1 text-[11px] font-semibold text-secondary hover:bg-surface-1"
          title="Choose which candidate stages this role sees">
          Stages
        </button>
      )}
    </div>
  );
}

export function CandidateStagesModal({ roleLabel, builtin, customId, access, catalogue, onClose, onSaved }: {
  roleLabel: string;
  /** A built-in role's name ("Sales") — OR `customId`. */
  builtin?: string;
  customId?: number;
  access: StageAccess;
  catalogue: StageCatalogue;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [picked, setPicked] = useState<string[]>(access.stages);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const order = catalogue.stages;
  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const changed = !sameStages(picked, access.stages);
  const isDefault = sameStages(picked, access.default);
  const activePreset = catalogue.presets.find((p) => sameStages(p.stages, picked))?.key ?? null;
  const hidden = order.filter((s) => !pickedSet.has(s.key));

  const toggle = (key: string) =>
    setPicked((cur) => {
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      return order.map((s) => s.key).filter((k) => next.includes(k));
    });

  const save = async (stages: string[] | null) => {
    if (busy) return;
    if (stages && !stages.length) { setFailure("Pick at least one stage"); return; }
    setBusy(true);
    setFailure("");
    try {
      const res = await crmPut("/api/roles/stage-access", {
        builtin: builtin ?? null, custom_id: customId ?? null, stages,
      });
      onSaved(res.message || "Candidate stages saved");
    } catch (e: any) {
      setFailure(e?.message || "Could not save — try again");
      setBusy(false);
    }
  };
  useCtrlEnter(() => { if (changed && picked.length) void save(picked); });

  return (
    <Modal
      title={`Candidate stages — ${roleLabel}`}
      medium
      dirty={changed}
      onClose={() => { if (!busy) onClose(); }}
      hero={<DialogHero tone="indigo" icon={Filter} eyebrow="Candidate stages" title={roleLabel}
        subtitle="Which candidates this role sees on Candidate Profiles and inside every opportunity."
        chips={<span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold ring-1 ring-white/20">
          Sees {picked.length} of {order.length} · {stageSummary(picked, catalogue)}
        </span>} />}
      footer={
        <DialogActions tone="indigo" icon={Save} label="Save stages" busy={busy}
          disabled={!changed || !picked.length} onCancel={onClose} onConfirm={() => void save(picked)}
          hint={!picked.length ? <span className="text-warning">Pick at least one stage</span>
            : !changed ? "Nothing changed yet" : undefined} />
      }
    >
      <div className="space-y-4">
        <DialogSection n={1} title="Start from a preset" tone="indigo" done={activePreset != null} optional
          action={!isDefault ? (
            <button type="button" disabled={busy} onClick={() => setPicked(access.default)}
              className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
              title="The stages this role sees when nobody set them">
              <RotateCcw size={12} aria-hidden /> Role default
            </button>
          ) : undefined}>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Presets">
            {catalogue.presets.map((p) => {
              const on = activePreset === p.key;
              return (
                <button key={p.key} type="button" onClick={() => setPicked(p.stages)} aria-pressed={on}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition-colors ${on
                    ? "bg-indigo-600 text-white ring-indigo-600"
                    : "bg-surface-1 text-secondary ring-subtle hover:bg-indigo-50 dark:hover:bg-indigo-950/40"}`}>
                  {p.label}
                </button>
              );
            })}
          </div>
        </DialogSection>

        <DialogSection n={2} title="Tick the stages this role sees" tone="indigo" done={picked.length > 0}
          hint="In the order a candidate moves through them. A closed candidate shows only when Closed AND the stage it closed in are ticked.">
          <ol className="grid gap-1.5 sm:grid-cols-2">
            {order.map((s, i) => {
              const on = pickedSet.has(s.key);
              return (
                <li key={s.key}>
                  <button type="button" onClick={() => toggle(s.key)} aria-pressed={on}
                    className={`flex w-full items-center gap-2.5 rounded-control border px-2.5 py-2 text-left transition-colors ${on
                      ? "border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/40"
                      : "border-subtle bg-surface-1 opacity-70 hover:opacity-100"}`}>
                    <span className={`grid h-5 w-5 flex-none place-items-center rounded border ${on
                      ? "border-indigo-600 bg-indigo-600 text-white" : "border-strong bg-surface-1"}`} aria-hidden>
                      {on && <Check size={13} />}
                    </span>
                    <span className="w-5 flex-none text-right text-[11px] font-bold tabular-nums text-muted">{i + 1}</span>
                    <span className={`truncate rounded-full px-2 py-0.5 text-xs font-semibold ${STAGE_TONE[s.key] || STAGE_TONE.all}`}>
                      {s.label}
                    </span>
                    {on ? <Eye size={13} className="ml-auto flex-none text-indigo-600 dark:text-indigo-300" aria-label="Shown" />
                      : <EyeOff size={13} className="ml-auto flex-none text-muted" aria-label="Hidden" />}
                  </button>
                </li>
              );
            })}
          </ol>
        </DialogSection>

        <WhatHappens tone="indigo" title="What this changes" items={[
          { icon: Eye, text: <>People in <b>{roleLabel}</b> see only these stage chips, and only these stages' candidates, on Candidate Profiles and on every opportunity's Applicants / Applied Candidates — counts and exports too.</> },
          ...(hidden.length ? [{ icon: EyeOff, text: <>Hidden: {hidden.map((s) => s.label).join(", ")}.</> }] : []),
          { icon: Link2, text: "A direct link to one candidate's profile still opens. Someone with several roles sees every stage any of their roles has. Admin and CEO always see everything." },
        ]} />
        <DialogFailure message={failure} />
        {!access.is_default && (
          <p className="text-xs text-muted">
            Set by an admin.{" "}
            <button type="button" className="font-semibold text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300"
              disabled={busy} onClick={() => void save(null)}>
              Go back to the role default
            </button>{" "}({stageSummary(access.default, catalogue)}).
          </p>
        )}
      </div>
    </Modal>
  );
}
