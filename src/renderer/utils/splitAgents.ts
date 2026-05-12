import { backendFetch } from "./backendApi";

export type SplitAgent = "claude" | "codex" | "cursor";

export type AgentSplit = {
  agent: SplitAgent;
  prompt: string;
  reason: string;
};

type SplitAgentsResponse = {
  splits: AgentSplit[];
  parse_warning: boolean;
  error: string | null;
};

/** Ask the backend to fan one prompt out across 1–3 agents.
 *
 * Returns the validated split list. Callers should fall back to
 * single-agent dispatch when the list has 0 or 1 entries — the heuristic
 * router in agentIntent.js handles those well enough.
 */
export async function splitAgentsForPrompt(
  prompt: string,
  repoContextSummary?: string | null,
): Promise<AgentSplit[]> {
  const trimmed = prompt.trim();
  if (!trimmed) return [];

  const body = JSON.stringify({
    prompt: trimmed,
    repo_context_summary: repoContextSummary ?? null,
  });

  const res = await backendFetch<SplitAgentsResponse>("/v1/split-agents", {
    method: "POST",
    body,
  });
  return Array.isArray(res.splits) ? res.splits : [];
}
