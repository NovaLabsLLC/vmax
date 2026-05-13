import { backendFetch } from "./backendApi";

/** Overlay/voice unblock when FastAPI is down or wedged — `fetch` has no implicit timeout. */
const SPLIT_AGENTS_TIMEOUT_MS = 14_000;

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

/** Build `exec.dispatch` args from `/v1/split-agents` results.
 *
 * - **≥2** specs → `{ agentPrompts }` (parallel, per split).
 * - **1** spec → `{ agent, prompt }` so main does **not** re-run the pill
 *   heuristic on the full user message (that was dropping Cursor/Claude picks).
 * - **0** specs → `{ prompt }` only (heuristic router in `dispatch.js`).
 */
export function dispatchPayloadFromSplits(
  userPrompt: string,
  splits: AgentSplit[],
): { agentPrompts: AgentSplit[] } | { agent: SplitAgent; prompt: string } | { prompt: string } {
  const trimmed = userPrompt.trim();
  if (splits.length >= 2) return { agentPrompts: splits };
  if (splits.length === 1) {
    const s = splits[0];
    const p = (s.prompt || "").trim() || trimmed;
    return { agent: s.agent, prompt: p };
  }
  return { prompt: trimmed };
}

/** Ask the backend to fan one prompt out across 1–3 agents.
 *
 * Returns the validated split list. When empty, callers should use
 * `dispatchPayloadFromSplits` so the heuristic router still runs on the
 * full prompt; when one row returns, use the same helper to **force** that agent.
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

  const ac = new AbortController();
  const timer = window.setTimeout(() => ac.abort(), SPLIT_AGENTS_TIMEOUT_MS);
  try {
    const res = await backendFetch<SplitAgentsResponse>("/v1/split-agents", {
      method: "POST",
      body,
      signal: ac.signal,
    });
    return Array.isArray(res.splits) ? res.splits : [];
  } finally {
    window.clearTimeout(timer);
  }
}
