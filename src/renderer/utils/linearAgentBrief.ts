import { backendFetch } from "./backendApi";

/** Response from POST /v1/linear/issues/{issueId}/agent-brief */
export type LinearAgentBriefResult = {
  task_text: string;
  linear_updated: boolean;
  linear_error?: string;
};

/**
 * Builds a richer “agent briefing” via the backend LLM, syncs into Linear when
 * possible, returns the full Workspace task Markdown (bundle + briefing).
 */
export async function fetchLinearIssueAgentBrief(
  issueIdentifier: string,
  workspaceBundle: string,
): Promise<LinearAgentBriefResult> {
  const id = encodeURIComponent(issueIdentifier.trim());
  return backendFetch<LinearAgentBriefResult>(
    `/v1/linear/issues/${id}/agent-brief`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace_bundle: workspaceBundle }),
    },
  );
}
