/**
 * Which OpenAI model runs what (9 Oct 2026) — the ONE client source of model
 * names. Every screen that mentions the AI reads its label from
 * `GET /interview/ai-engine` (staff only), so a switch in Settings ▸ AI engine
 * changes every label at once. The client keeps NO table of names: it only
 * prettifies an id that arrived without a label (records written before the
 * server sent labels).
 */
import { useEffect, useState } from "react";

import { authFetch } from "../api/client";

export type AiModel = { id: string; label: string; provider: string; reasoning: boolean };

export type AiEngine = {
  interview: AiModel;
  fast: AiModel;
  live_voice: AiModel;
  transcription: AiModel;
  voice: AiModel;
  ask_ai: AiModel;
  ocr: AiModel;
  show_to_candidates: boolean;
  supported?: AiModel[];
};

/** "gpt-7-nova" → "GPT-7 Nova"; never blank. PURE. */
export function prettifyModelId(id?: string | null): string {
  const raw = String(id || "").trim();
  if (!raw) return "OpenAI";
  const parts = raw.split(/[-_\s]+/).filter(Boolean);
  const out: string[] = [];
  parts.forEach((part, i) => {
    const low = part.toLowerCase();
    if (i === 0 && low === "gpt") out.push("GPT");
    else if (i === 1 && out[0] === "GPT") out[0] = `GPT-${part}`;
    else if (low === "mini" || low === "nano") out.push(low);
    else out.push(part.charAt(0).toUpperCase() + part.slice(1));
  });
  return out.join(" ");
}

/** The label the server sent, else the prettified id. PURE. */
export function modelLabel(id?: string | null, label?: string | null): string {
  const given = String(label || "").trim();
  return given || prettifyModelId(id);
}

let enginePromise: Promise<AiEngine | null> | null = null;

/** One fetch per page load (retried after a failure). */
export function fetchAiEngine(): Promise<AiEngine | null> {
  if (!enginePromise) {
    enginePromise = authFetch("/interview/ai-engine")
      .then(async (res) => (res.ok ? ((await res.json()) as AiEngine) : null))
      .catch(() => null)
      .then((data) => {
        if (!data || !data.interview) enginePromise = null;
        return data && data.interview ? data : null;
      });
  }
  return enginePromise;
}

/** Test hook: forget the cached engine. */
export function resetAiEngineCache(): void {
  enginePromise = null;
}

/** The engine, or null while loading / on an error — callers fall back gracefully. */
export function useAiEngine(): AiEngine | null {
  const [engine, setEngine] = useState<AiEngine | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchAiEngine().then((e) => {
      if (alive) setEngine(e);
    });
    return () => {
      alive = false;
    };
  }, []);
  return engine;
}
