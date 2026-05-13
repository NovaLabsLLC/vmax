import { backendFetch } from "./backendApi";
import { parsePillDualAgentPrompts } from "./pillDelimiterSplit";

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
):
  | { agentPrompts: AgentSplit[] }
  | { agent: SplitAgent; prompt: string; routingReason: string }
  | { prompt: string } {
  const trimmed = userPrompt.trim();
  if (splits.length >= 2) return { agentPrompts: splits };
  if (splits.length === 1) {
    const s = splits[0];
    const p = (s.prompt || "").trim() || trimmed;
    const routingReason = (s.reason || "").trim() || "split-agents";
    /* `routingReason` tells main process this is LLM split routing, not a user "forced" override. */
    return { agent: s.agent, prompt: p, routingReason };
  }
  return { prompt: trimmed };
}

/** Ask the backend to fan one prompt out across 1–3 agents.
 *
 * Returns the validated split list. When empty, callers should use
 * `dispatchPayloadFromSplits` so the heuristic router still runs on the
 * full prompt; when one row returns, use the same helper to **force** that agent.
 */
/**
 * When the message contains two or more `<<<VMAX:AGENT:*>>>` blocks, skip `/v1/split-agents`
 * and send `{ prompt }` only so Electron's `parsePillDualAgentPrompts` fan-out wins.
 */
export function pillDelimiterDispatchPayload(prompt: string): { prompt: string } | null {
  const trimmed = prompt.trim();
  if (!trimmed) return null;
  const parsed = parsePillDualAgentPrompts(trimmed);
  return parsed && parsed.length >= 2 ? { prompt: trimmed } : null;
}

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
