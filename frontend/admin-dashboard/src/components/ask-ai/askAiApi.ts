/** Ask AI API helpers — read-only help assistant. */
import { crmGet, crmPost } from "../../crm/api";

export type AskAiAction = {
  type: string;
  path?: string;
  label?: string;
  requires_confirmation?: boolean;
  enabled?: boolean;
};

export type AskAiAssistResult = {
  reply: string;
  navigate_to: string | null;
  tab_key: string;
  tab_title: string;
  suggested_prompts: string[];
  actions: AskAiAction[];
  tools_used: string[];
  tool_results: unknown[];
  read_only: boolean;
};

export type AskAiHelpContext = {
  tab_key: string;
  title: string;
  purpose: string;
  suggested_prompts: string[];
  related_routes: { key: string; title: string; path: string }[];
  read_only: boolean;
};

export type ChatTurn = { role: "user" | "assistant"; content: string; navigateTo?: string | null };

export async function fetchHelpContext(route: string): Promise<AskAiHelpContext> {
  const { data } = await crmGet<AskAiHelpContext>(
    `/api/ai/help-context?route=${encodeURIComponent(route || "dashboard")}`,
  );
  return data;
}

export async function postAssist(opts: {
  message: string;
  route: string;
  history: { role: string; content: string }[];
}): Promise<AskAiAssistResult> {
  const { data } = await crmPost<AskAiAssistResult>("/api/ai/assist", {
    message: opts.message,
    route: opts.route,
    history: opts.history,
    enable_tools: false,
    confirm_actions: true,
  });
  return data;
}
