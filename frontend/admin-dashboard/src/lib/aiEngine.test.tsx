/**
 * The AI model shown in the UI (9 Oct 2026): label fallback, one fetch per page
 * load, the chips on the report page, and Settings ▸ AI engine editable for
 * Admin / CEO only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { CrmMeProvider, type Me } from "../crm/CrmApp";
import { AiModelChip, InterviewModelChips } from "../components/AiModelChip";
import { AiEngineTab } from "../crm/pages/settings/AiEngineTab";
import { fetchAiEngine, modelLabel, prettifyModelId, resetAiEngineCache } from "./aiEngine";

const ENGINE = {
  interview: { id: "gpt-6-astra", label: "GPT-6 Astra", provider: "OpenAI", reasoning: true },
  fast: { id: "gpt-4o-mini", label: "GPT-4o mini", provider: "OpenAI", reasoning: false },
  live_voice: { id: "gpt-realtime-mini", label: "GPT Realtime mini", provider: "OpenAI", reasoning: false },
  transcription: { id: "gpt-4o-mini-transcribe", label: "GPT-4o mini Transcribe", provider: "OpenAI", reasoning: false },
  voice: { id: "gpt-4o-mini-tts", label: "GPT-4o mini TTS", provider: "OpenAI", reasoning: false },
  ask_ai: { id: "gpt-4o-mini", label: "GPT-4o mini", provider: "OpenAI", reasoning: false },
  ocr: { id: "gpt-4o-mini", label: "GPT-4o mini", provider: "OpenAI", reasoning: false },
  show_to_candidates: true,
  supported: [
    { id: "gpt-6-astra", label: "GPT-6 Astra", provider: "OpenAI", reasoning: true },
    { id: "gpt-4o-mini", label: "GPT-4o mini", provider: "OpenAI", reasoning: false },
  ],
};

let calls = 0;
beforeEach(() => {
  calls = 0;
  resetAiEngineCache();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("/interview/ai-engine")) {
      calls += 1;
      return new Response(JSON.stringify(ENGINE), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(url).includes("/api/org-settings")) {
      return new Response(JSON.stringify({ success: true, data: { settings: [] } }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: 404 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("model labels", () => {
  it("prefers the server label and prettifies a bare id", () => {
    expect(modelLabel("gpt-6-astra", "GPT-6 Astra")).toBe("GPT-6 Astra");
    expect(prettifyModelId("gpt-7-nova")).toBe("GPT-7 Nova");
    expect(prettifyModelId("gpt-4o-mini")).toBe("GPT-4o mini");
    expect(prettifyModelId("")).toBe("OpenAI");
  });

  it("fetches the engine once per page load", async () => {
    const [a, b] = await Promise.all([fetchAiEngine(), fetchAiEngine()]);
    await fetchAiEngine();
    expect(a?.interview.label).toBe("GPT-6 Astra");
    expect(b).toBe(a);
    expect(calls).toBe(1);
  });
});

describe("model chips", () => {
  it("one chip when the same model asked and scored", () => {
    render(<InterviewModelChips model="gpt-6-astra" modelLabel="GPT-6 Astra" evaluationModel="gpt-6-astra" />);
    expect(screen.getByText("GPT-6 Astra")).toBeTruthy();
    expect(screen.queryByText(/Scoring/)).toBeNull();
  });

  it("questions and scoring separately after a re-score on another model", () => {
    render(<InterviewModelChips model="gpt-4o-mini" evaluationModel="gpt-6-astra" evaluationModelLabel="GPT-6 Astra" />);
    expect(screen.getByText("Questions: GPT-4o mini")).toBeTruthy();
    expect(screen.getByText("Scoring: GPT-6 Astra")).toBeTruthy();
  });

  it("nothing when no model is known", () => {
    const { container } = render(<InterviewModelChips />);
    expect(container.textContent).toBe("");
  });

  it("chip tooltip names the provider and the reasoning kind", () => {
    render(<AiModelChip id="gpt-6-astra" label="GPT-6 Astra" reasoning />);
    expect(screen.getByTitle("OpenAI GPT-6 Astra · reasoning model")).toBeTruthy();
  });
});

describe("Settings ▸ AI engine", () => {
  const me = (roles: string[]): Me => ({ id: 1, username: "u", full_name: "U", email: "u@x.in", roles });

  it("is editable for Admin / CEO and read-only for everyone else", async () => {
    const { unmount } = render(
      <CrmMeProvider value={me(["CEO"])}><AiEngineTab notify={() => {}} /></CrmMeProvider>,
    );
    await waitFor(() => expect(screen.getByText("Change the model")).toBeTruthy());
    expect(screen.getAllByText("GPT-6 Astra").length).toBeGreaterThan(0);
    unmount();
    resetAiEngineCache();
    render(<CrmMeProvider value={me(["RMG"])}><AiEngineTab notify={() => {}} /></CrmMeProvider>);
    await waitFor(() => expect(screen.getByText("Models in use")).toBeTruthy());
    expect(screen.queryByText("Change the model")).toBeNull();
  }, 30000);
});
