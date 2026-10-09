/**
 * Settings ▸ AI engine (9 Oct 2026) — which OpenAI model runs what, and the
 * switch for the interview model. Everyone who reaches it sees the read-only
 * list (`GET /interview/ai-engine`); Admin / CEO pick the interview model and the
 * fast model from the supported list and choose whether candidates see the name.
 * Saved through the ordinary `PUT /api/org-settings` (the server validates the
 * model against its allow-list and audits who changed it, from what to what).
 */
import { useCallback, useEffect, useState } from "react";
import { Cpu } from "lucide-react";

import { crmGet, crmPut } from "../../api";
import { useHasRole } from "../../CrmApp";
import { CONTROL } from "../../components/controlTower";
import { ErrorBox, Spinner, btnPrimary, btnSecondary } from "../../components/ui";
import { AiModelChip } from "../../../components/AiModelChip";
import { fetchAiEngine, resetAiEngineCache, type AiEngine, type AiModel } from "../../../lib/aiEngine";

type Notify = (msg: string, kind?: "ok" | "err") => void;
type OrgSetting = { key: string; value: string; source: string };

const KEYS = {
  interview: "ai.interview_model",
  fast: "ai.interview_fast_model",
  show: "ui.show_ai_model_to_candidates",
} as const;

const ROLES: { key: keyof Omit<AiEngine, "show_to_candidates" | "supported">; label: string; hint: string }[] = [
  { key: "interview", label: "Interviews", hint: "Questions, per-answer evaluation, the final report and re-score." },
  { key: "fast", label: "Fast replies", hint: "Calls the candidate waits on between answers — follow-ups, lead-ins, repeat / explain, closing answers." },
  { key: "live_voice", label: "Live voice", hint: "Templates with Voice: Live." },
  { key: "transcription", label: "Transcription", hint: "The candidate's spoken answers." },
  { key: "voice", label: "Spoken questions", hint: "Text-to-speech for the standard voice." },
  { key: "ask_ai", label: "Ask AI", hint: "The CRM assistant (uses tools, so never a reasoning model)." },
  { key: "ocr", label: "Reading images", hint: "Text out of an uploaded JD / CV image." },
];

export function AiEngineTab({ notify }: { notify: Notify }) {
  const isAdmin = useHasRole();
  const [engine, setEngine] = useState<AiEngine | null>(null);
  const [rows, setRows] = useState<Record<string, OrgSetting>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    resetAiEngineCache();
    const e = await fetchAiEngine();
    setEngine(e);
    if (!e) setError("Could not read the AI engine — the server may be older than this page.");
    if (isAdmin) {
      try {
        const res = await crmGet<{ settings: OrgSetting[] }>("/api/org-settings");
        setRows(Object.fromEntries((res.data?.settings || []).map((r) => [r.key, r])));
      } catch {
        setRows({});
      }
    }
    setDraft({});
    setLoading(false);
  }, [isAdmin]);
  useEffect(() => { void load(); }, [load]);

  const stored = (key: string) => (rows[key]?.source === "settings" ? rows[key].value : "");
  const value = (key: string) => draft[key] ?? stored(key);
  const dirty = Object.keys(draft).some((k) => draft[k] !== stored(k));
  const supported: AiModel[] = engine?.supported || [];

  const save = async () => {
    setSaving(true);
    try {
      const values = Object.fromEntries(Object.entries(draft).filter(([k, v]) => v !== stored(k)));
      const res = await crmPut("/api/org-settings", { values });
      notify(res.message || "AI engine saved");
      await load();
    } catch (e: any) {
      notify(e?.message || "Could not save the AI engine", "err");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner label="Loading the AI engine…" />;

  return (
    <div className="space-y-4">
      {error && <ErrorBox error={error} onRetry={() => void load()} />}

      {engine && (
        <div className="overflow-hidden rounded-card border border-subtle bg-surface-1 shadow-raised">
          <div className="flex items-center gap-2 border-b border-subtle px-4 py-3">
            <Cpu size={16} className="text-brand-600 dark:text-brand-300" aria-hidden />
            <div className="text-sm font-bold text-primary">Models in use</div>
          </div>
          <ul className="divide-y divide-subtle">
            {ROLES.map((r) => {
              const m = engine[r.key] as AiModel | undefined;
              return (
                <li key={r.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-primary">{r.label}</div>
                    <div className="text-xs text-muted">{r.hint}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {m && <AiModelChip id={m.id} label={m.label} reasoning={m.reasoning} />}
                    {m?.reasoning && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800">
                        reasoning
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-subtle px-4 py-2 text-xs text-muted">
            Candidates {engine.show_to_candidates ? "see" : "do not see"} the interview model's name on their screen.
          </div>
        </div>
      )}

      {isAdmin && engine && (
        <div className="rounded-card border border-subtle bg-surface-1 p-4 shadow-raised">
          <div className="text-sm font-bold text-primary">Change the model</div>
          <p className="mt-0.5 text-xs text-muted">
            Applies to interviews that start from now on; interviews in progress keep their model. The other server
            process picks the change up within a minute.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-secondary">
              Interview model
              <select className={`${CONTROL} mt-1 w-full`} value={value(KEYS.interview)}
                onChange={(e) => setDraft((d) => ({ ...d, [KEYS.interview]: e.target.value }))}>
                <option value="">Server default ({engine.interview.label})</option>
                {supported.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}{m.reasoning ? " · reasoning" : ""}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold text-secondary">
              Fast-reply model
              <select className={`${CONTROL} mt-1 w-full`} value={value(KEYS.fast)}
                onChange={(e) => setDraft((d) => ({ ...d, [KEYS.fast]: e.target.value }))}>
                <option value="">Automatic (GPT-4o mini while the interview model is a reasoning model)</option>
                {supported.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}{m.reasoning ? " · reasoning (slower replies)" : ""}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="mt-4 inline-flex items-center gap-2 text-sm text-primary">
            <input type="checkbox"
              checked={(value(KEYS.show) || (engine.show_to_candidates ? "true" : "false")) === "true"}
              onChange={(e) => setDraft((d) => ({ ...d, [KEYS.show]: e.target.checked ? "true" : "false" }))} />
            Show the AI model to candidates ("AI Interviewer · {engine.interview.label}")
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={btnSecondary} disabled={!dirty || saving} onClick={() => setDraft({})}>
              Undo
            </button>
            <button type="button" className={btnPrimary} disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
